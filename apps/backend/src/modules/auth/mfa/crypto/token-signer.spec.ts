import { randomBytes } from 'crypto';

import { EnvKekAdapter } from './env-kek.adapter';
import { StepUpTokenSigner, TrustedDeviceTokenSigner } from './token-signer';

const kms = new EnvKekAdapter(randomBytes(32).toString('base64'));
const nowSec = () => Math.floor(Date.now() / 1000);

describe('StepUpTokenSigner', () => {
  const claims = {
    sub: 'user-1',
    sid: 'session-1',
    scope: 'role:create',
    jti: 'jti-1',
    expiresAtSec: nowSec() + 300,
  };

  it('sign → verify roundtrips all claims', async () => {
    const signer = new StepUpTokenSigner(kms);
    const token = await signer.sign(claims);
    const verified = await signer.verify(token);
    expect(verified).toMatchObject({
      sub: 'user-1',
      sid: 'session-1',
      scope: 'role:create',
      jti: 'jti-1',
    });
    expect(verified.exp).toBe(claims.expiresAtSec);
  });

  it('rejects an expired token', async () => {
    const signer = new StepUpTokenSigner(kms);
    const token = await signer.sign({ ...claims, expiresAtSec: nowSec() - 10 });
    await expect(signer.verify(token)).rejects.toThrow();
  });

  it('rejects a token signed under a different KEK', async () => {
    const signer = new StepUpTokenSigner(kms);
    const otherSigner = new StepUpTokenSigner(
      new EnvKekAdapter(randomBytes(32).toString('base64')),
    );
    const token = await otherSigner.sign(claims);
    await expect(signer.verify(token)).rejects.toThrow();
  });

  it('rejects a trusted-device token (distinct sub-key + typ)', async () => {
    const stepUp = new StepUpTokenSigner(kms);
    const trustedDevice = new TrustedDeviceTokenSigner(kms);
    const tdToken = await trustedDevice.sign({
      sub: 'user-1',
      deviceId: 'device-1',
      expiresAtSec: nowSec() + 300,
    });
    await expect(stepUp.verify(tdToken)).rejects.toThrow();
  });
});

describe('TrustedDeviceTokenSigner', () => {
  it('sign → verify roundtrips claims', async () => {
    const signer = new TrustedDeviceTokenSigner(kms);
    const exp = nowSec() + 600;
    const token = await signer.sign({ sub: 'user-1', deviceId: 'device-9', expiresAtSec: exp });
    await expect(signer.verify(token)).resolves.toEqual({
      sub: 'user-1',
      deviceId: 'device-9',
      exp,
    });
  });

  it('rejects an expired trusted-device token', async () => {
    const signer = new TrustedDeviceTokenSigner(kms);
    const token = await signer.sign({
      sub: 'user-1',
      deviceId: 'device-9',
      expiresAtSec: nowSec() - 10,
    });
    await expect(signer.verify(token)).rejects.toThrow();
  });

  it('rejects a step-up token', async () => {
    const stepUp = new StepUpTokenSigner(kms);
    const trustedDevice = new TrustedDeviceTokenSigner(kms);
    const token = await stepUp.sign({
      sub: 'user-1',
      sid: 's-1',
      scope: 'x',
      jti: 'j-1',
      expiresAtSec: nowSec() + 300,
    });
    await expect(trustedDevice.verify(token)).rejects.toThrow();
  });
});
