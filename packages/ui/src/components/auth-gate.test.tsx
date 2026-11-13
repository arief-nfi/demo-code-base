import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { AuthGate, type AuthGateErrorState } from './auth-gate';
import { ApiRequestError } from '../lib/api-client';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const fallback = <p>checking session</p>;
const renderError = (retry: () => void, state: AuthGateErrorState) => (
  <button onClick={retry}>{state.retrying ? 'retrying' : 'retry'}</button>
);

function renderGate(loadSession: () => Promise<unknown>, onSession?: (s: unknown) => boolean | void) {
  return render(
    <AuthGate loadSession={loadSession} onSession={onSession} fallback={fallback} renderError={renderError}>
      <p>dashboard</p>
    </AuthGate>,
  );
}

describe('AuthGate', () => {
  it('server-renders only the fallback', () => {
    const html = renderToString(
      <AuthGate loadSession={() => new Promise(() => {})} fallback={fallback} renderError={renderError}>
        <p>dashboard</p>
      </AuthGate>,
    );
    expect(html).toContain('checking session');
    expect(html).not.toContain('dashboard');
  });

  it('shows the fallback, not the children, while the session loads', () => {
    renderGate(() => new Promise(() => {}));
    expect(screen.getByText('checking session')).toBeInTheDocument();
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();
  });

  it('applies the session before the children first render', async () => {
    const load = deferred<{ roles: string[] }>();
    let applied: string[] | null = null;
    function Child() {
      return <p>{applied ? `roles:${applied.join(',')}` : 'no session yet'}</p>;
    }
    render(
      <AuthGate
        loadSession={() => load.promise}
        onSession={(s) => { applied = s.roles; }}
        fallback={fallback}
        renderError={renderError}
      >
        <Child />
      </AuthGate>,
    );

    await act(async () => load.resolve({ roles: ['ADMIN'] }));

    expect(screen.getByText('roles:ADMIN')).toBeInTheDocument();
    expect(screen.queryByText('no session yet')).not.toBeInTheDocument();
  });

  it('keeps the fallback when onSession returns false (redirecting elsewhere)', async () => {
    const load = deferred<object>();
    renderGate(() => load.promise, () => false);

    await act(async () => load.resolve({}));

    expect(screen.getByText('checking session')).toBeInTheDocument();
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();
  });

  it('keeps the fallback on a 401 — the api-client is already redirecting to /login', async () => {
    const load = deferred<object>();
    renderGate(() => load.promise);

    await act(async () => load.reject(new ApiRequestError(401, 'Unauthorized')));

    expect(screen.getByText('checking session')).toBeInTheDocument();
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('retry')).not.toBeInTheDocument();
  });

  it.each(['Tenant suspended', 'Tenant terminated'])(
    'keeps the fallback on a 403 "%s" — the api-client is redirecting to /tenant-suspended',
    async (message) => {
      const load = deferred<object>();
      renderGate(() => load.promise);

      await act(async () => load.reject(new ApiRequestError(403, message)));

      expect(screen.getByText('checking session')).toBeInTheDocument();
      expect(screen.queryByText('retry')).not.toBeInTheDocument();
    },
  );

  it('shows the error (not the children) for other failures, and retry loads again', async () => {
    const first = deferred<object>();
    const second = deferred<object>();
    const loadSession = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderGate(loadSession);

    await act(async () => first.reject(new ApiRequestError(500, 'Internal server error')));
    expect(screen.getByText('retry')).toBeInTheDocument();
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('retry'));
    // The error screen stays up while the retry runs: no flash to the blank fallback.
    expect(screen.getByText('retrying')).toBeInTheDocument();
    expect(screen.queryByText('checking session')).not.toBeInTheDocument();

    await act(async () => second.resolve({}));
    expect(screen.getByText('dashboard')).toBeInTheDocument();
    expect(loadSession).toHaveBeenCalledTimes(2);
  });

  it('tells the error screen what failed and how many attempts in a row failed', async () => {
    const first = deferred<object>();
    const second = deferred<object>();
    const loadSession = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const states: AuthGateErrorState[] = [];
    render(
      <AuthGate
        loadSession={loadSession}
        fallback={fallback}
        renderError={(retry, state) => {
          states.push(state);
          return <button onClick={retry}>retry</button>;
        }}
      >
        <p>dashboard</p>
      </AuthGate>,
    );

    const offline = new TypeError('Failed to fetch');
    await act(async () => first.reject(offline));
    expect(states.at(-1)).toEqual({ error: offline, retrying: false, failures: 1 });

    await userEvent.click(screen.getByText('retry'));
    expect(states.at(-1)).toEqual({ error: offline, retrying: true, failures: 1 });

    const unavailable = new ApiRequestError(503, 'Service Unavailable');
    await act(async () => second.reject(unavailable));
    expect(states.at(-1)).toEqual({ error: unavailable, retrying: false, failures: 2 });
  });

  it('shows the fallback when a retry ends in a redirect to /login', async () => {
    const first = deferred<object>();
    const second = deferred<object>();
    const loadSession = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderGate(loadSession);

    await act(async () => first.reject(new TypeError('Failed to fetch')));
    await userEvent.click(screen.getByText('retry'));
    await act(async () => second.reject(new ApiRequestError(401, 'Unauthorized')));

    expect(screen.getByText('checking session')).toBeInTheDocument();
    expect(screen.queryByText('retry')).not.toBeInTheDocument();
  });

  it('shows the error (not an endless spinner) when onSession throws', async () => {
    const load = deferred<object>();
    renderGate(() => load.promise, () => { throw new TypeError("Cannot read properties of undefined (reading 'includes')"); });

    await act(async () => load.resolve({}));

    expect(screen.getByText('retry')).toBeInTheDocument();
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();
  });

  it('shows the error for a network failure and for a 403 that is not a tenant status', async () => {
    for (const err of [new TypeError('Failed to fetch'), new ApiRequestError(403, 'Forbidden')]) {
      const load = deferred<object>();
      const { unmount } = renderGate(() => load.promise);
      await act(async () => load.reject(err));
      expect(screen.getByText('retry')).toBeInTheDocument();
      unmount();
    }
  });
});
