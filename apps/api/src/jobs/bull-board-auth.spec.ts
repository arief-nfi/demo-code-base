import { bullBoardAuth } from './bull-board-auth';

function fakeRes() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function setup(opts: { verify?: (token: string) => { sub: string; tenantSlug?: string }; sysadmin?: boolean } = {}) {
  const verify = jest.fn(opts.verify ?? (() => ({ sub: 'u1', tenantSlug: 'system' })));
  const isSysadmin = jest.fn(async () => opts.sysadmin ?? false);
  return { middleware: bullBoardAuth({ verify, isSysadmin }), verify, isSysadmin };
}

describe('bullBoardAuth', () => {
  it('responds 401 without a token cookie', async () => {
    const { middleware } = setup();
    const res = fakeRes();
    const next = jest.fn();

    await middleware({ cookies: {} } as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 when the token does not verify', async () => {
    const { middleware } = setup({ verify: () => { throw new Error('jwt expired'); } });
    const res = fakeRes();
    const next = jest.fn();

    await middleware({ cookies: { token: 'bad' } } as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 403 for a signed-in non-sysadmin', async () => {
    const { middleware } = setup({ sysadmin: false });
    const res = fakeRes();
    const next = jest.fn();

    await middleware({ cookies: { token: 'ok' } } as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next for a sysadmin', async () => {
    const { middleware, verify, isSysadmin } = setup({ sysadmin: true });
    const res = fakeRes();
    const next = jest.fn();

    await middleware({ cookies: { token: 'ok' } } as any, res as any, next);

    expect(verify).toHaveBeenCalledWith('ok');
    expect(isSysadmin).toHaveBeenCalledWith('u1', 'system');
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responds 401 when the role lookup fails (deleted user, broken schema)', async () => {
    const { middleware, isSysadmin } = setup();
    isSysadmin.mockRejectedValueOnce(new Error('relation does not exist'));
    const res = fakeRes();
    const next = jest.fn();

    await middleware({ cookies: { token: 'ok' } } as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
