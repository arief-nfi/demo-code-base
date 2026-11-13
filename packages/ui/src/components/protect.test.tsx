import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { Protect } from './protect';
import { useRBACStore } from '../stores/rbac-store';

describe('Protect', () => {
  beforeEach(() => {
    // Reset store to initial state with _hydrated = true so isLoading = false
    act(() => {
      useRBACStore.setState({ roles: [], permissions: [], _hydrated: true });
    });
  });

  it('renders children when user has required role', () => {
    act(() => {
      useRBACStore.getState().setRBAC(['ADMIN'], []);
    });

    render(
      <Protect roles={['ADMIN']}>
        <p>Protected content</p>
      </Protect>,
    );

    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('renders children when user has required permission', () => {
    act(() => {
      useRBACStore.getState().setRBAC([], ['system.user.read']);
    });

    render(
      <Protect permissions={['system.user.read']}>
        <p>Protected content</p>
      </Protect>,
    );

    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('renders fallback when user lacks required role', () => {
    act(() => {
      useRBACStore.getState().setRBAC(['USER'], []);
    });

    render(
      <Protect roles={['ADMIN']} fallback={<p>No access</p>}>
        <p>Protected content</p>
      </Protect>,
    );

    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(screen.getByText('No access')).toBeInTheDocument();
  });

  it('renders nothing (null) by default when unauthorized', () => {
    act(() => {
      useRBACStore.getState().setRBAC([], []);
    });

    const { container } = render(
      <Protect roles={['ADMIN']}>
        <p>Protected content</p>
      </Protect>,
    );

    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(container.textContent).toBe('');
  });

  it('renders children when no roles or permissions specified', () => {
    act(() => {
      useRBACStore.getState().setRBAC(['USER'], []);
    });

    render(
      <Protect>
        <p>Open content</p>
      </Protect>,
    );

    expect(screen.getByText('Open content')).toBeInTheDocument();
  });

  it('SYSADMIN can access everything', () => {
    act(() => {
      useRBACStore.getState().setRBAC(['SYSADMIN'], []);
    });

    render(
      <Protect roles={['ADMIN']} permissions={['some.restricted.perm']}>
        <p>Admin only</p>
      </Protect>,
    );

    expect(screen.getByText('Admin only')).toBeInTheDocument();
  });

  it('uses OR logic by default', () => {
    act(() => {
      useRBACStore.getState().setRBAC(['USER'], ['system.user.read']);
    });

    render(
      <Protect roles={['ADMIN']} permissions={['system.user.read']}>
        <p>Has permission</p>
      </Protect>,
    );

    expect(screen.getByText('Has permission')).toBeInTheDocument();
  });

  it('supports AND logic', () => {
    act(() => {
      useRBACStore.getState().setRBAC(['ADMIN'], []);
    });

    render(
      <Protect roles={['ADMIN']} permissions={['system.user.write']} logic="AND">
        <p>Both required</p>
      </Protect>,
    );

    expect(screen.queryByText('Both required')).not.toBeInTheDocument();
  });

  it('AND logic grants when both conditions met', () => {
    act(() => {
      useRBACStore.getState().setRBAC(['ADMIN'], ['system.user.write']);
    });

    render(
      <Protect roles={['ADMIN']} permissions={['system.user.write']} logic="AND">
        <p>Both required</p>
      </Protect>,
    );

    expect(screen.getByText('Both required')).toBeInTheDocument();
  });
});
