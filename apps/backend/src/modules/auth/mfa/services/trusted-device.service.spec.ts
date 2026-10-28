import { createHash } from 'crypto';

import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { RoleNameEnum } from 'src/shared/enums/role-name.enum';

import { lean, selectLean, selectPopulateLean } from 'src/testing/db-mocks';
import { TrustedDeviceService } from './trusted-device.service';

const fp = (ua: string) => createHash('sha256').update(ua).digest('base64');

function build() {
  const model = {
    create: jest.fn(async () => ({})),
    findOne: jest.fn(),
    updateOne: jest.fn(async () => ({})),
    updateMany: jest.fn(async () => ({})),
    find: jest.fn(),
  };
  const userModel = { findById: jest.fn() };
  const signer = { sign: jest.fn(async () => 'td-cookie'), verify: jest.fn() };
  const svc = new TrustedDeviceService(model as never, userModel as never, signer as never);
  return { model, userModel, signer, svc };
}

function stubUserRole(b: ReturnType<typeof build>, roleId: string | null, role: unknown) {
  b.userModel.findById.mockReturnValue(selectPopulateLean(roleId ? { role } : null));
}

describe('isEligible', () => {
  it('false when the user has no role', async () => {
    const b = build();
    stubUserRole(b, null, null);
    expect(await b.svc.isEligible('u')).toBe(false);
  });

  it('false for the admin role (by name)', async () => {
    const b = build();
    stubUserRole(b, 'r', { name: RoleNameEnum.ADMIN, permissions: [] });
    expect(await b.svc.isEligible('u')).toBe(false);
  });

  it('false for a role holding an admin-power permission', async () => {
    const b = build();
    stubUserRole(b, 'r', { name: 'Manager', permissions: [PermissionsEnum.DELETE_USER] });
    expect(await b.svc.isEligible('u')).toBe(false);
  });

  it('true for a plain member role', async () => {
    const b = build();
    stubUserRole(b, 'r', { name: 'Member', permissions: [PermissionsEnum.USER] });
    expect(await b.svc.isEligible('u')).toBe(true);
  });
});

describe('register', () => {
  it('returns null (no cookie) for an ineligible user', async () => {
    const b = build();
    stubUserRole(b, 'r', { name: RoleNameEnum.ADMIN, permissions: [] });
    expect(await b.svc.register({ userId: 'u' })).toBeNull();
    expect(b.model.create).not.toHaveBeenCalled();
  });

  it('creates a row and returns a signed cookie for an eligible user', async () => {
    const b = build();
    stubUserRole(b, 'r', { name: 'Member', permissions: [PermissionsEnum.USER] });
    const out = await b.svc.register({ userId: 'u', userAgent: 'UA/1.0' });
    expect(out?.cookieValue).toBe('td-cookie');
    expect(b.model.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u', deviceFingerprintHash: fp('UA/1.0') }),
    );
    expect(b.signer.sign).toHaveBeenCalled();
  });
});

describe('isTrusted', () => {
  const base = { userId: 'u', userAgent: 'UA/1.0', ip: '1.2.3.4' };

  it('null when no cookie', async () => {
    const b = build();
    expect(await b.svc.isTrusted({ cookieValue: null, ...base })).toBeNull();
  });

  it('null when the cookie signature is invalid', async () => {
    const b = build();
    b.signer.verify.mockRejectedValue(new Error('bad'));
    expect(await b.svc.isTrusted({ cookieValue: 'x', ...base })).toBeNull();
  });

  it('null when the cookie sub does not match the userId', async () => {
    const b = build();
    b.signer.verify.mockResolvedValue({ sub: 'someone-else', deviceId: 'd', exp: 9999 });
    expect(await b.svc.isTrusted({ cookieValue: 'x', ...base })).toBeNull();
    expect(b.model.findOne).not.toHaveBeenCalled();
  });

  it('null when no live (unrevoked, unexpired) row exists', async () => {
    const b = build();
    b.signer.verify.mockResolvedValue({ sub: 'u', deviceId: 'd', exp: 9999 });
    b.model.findOne.mockReturnValue(selectLean(null));
    expect(await b.svc.isTrusted({ cookieValue: 'x', ...base })).toBeNull();
  });

  it('null when the stored fingerprint does not match the current UA', async () => {
    const b = build();
    b.signer.verify.mockResolvedValue({ sub: 'u', deviceId: 'd', exp: 9999 });
    b.model.findOne.mockReturnValue(
      selectLean({ deviceId: 'd', deviceFingerprintHash: fp('OTHER') }),
    );
    expect(await b.svc.isTrusted({ cookieValue: 'x', ...base })).toBeNull();
    expect(b.model.updateOne).not.toHaveBeenCalled();
  });

  it('returns the deviceId and touches lastUsedAt when everything matches', async () => {
    const b = build();
    b.signer.verify.mockResolvedValue({ sub: 'u', deviceId: 'd', exp: 9999 });
    b.model.findOne.mockReturnValue(
      selectLean({ deviceId: 'd', deviceFingerprintHash: fp('UA/1.0') }),
    );
    expect(await b.svc.isTrusted({ cookieValue: 'x', ...base })).toEqual({ deviceId: 'd' });
    expect(b.model.updateOne).toHaveBeenCalledWith(
      { deviceId: 'd' },
      expect.objectContaining({ ipLastSeen: '1.2.3.4' }),
    );
  });
});

describe('revoke / list', () => {
  it('revoke marks a single device revoked', async () => {
    const b = build();
    await b.svc.revoke({ userId: 'u', deviceId: 'd' });
    expect(b.model.updateOne).toHaveBeenCalledWith(
      { userId: 'u', deviceId: 'd', revokedAt: null },
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    );
  });

  it('list returns unrevoked rows for the user', async () => {
    const b = build();
    b.model.find.mockReturnValue(
      lean([{ deviceId: 'd', userId: 'u', expiresAt: new Date(), createdAt: new Date() }]),
    );
    const rows = await b.svc.list('u');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('d');
  });
});
