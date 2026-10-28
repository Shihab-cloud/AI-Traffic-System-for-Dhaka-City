import { describe, expect, it } from 'vitest';

import { accessRequestMailto, supportMailto } from './url.util';

describe('supportMailto', () => {
  it('builds a link with only a subject when no body is given', () => {
    expect(supportMailto({ supportEmail: 'help@example.com', subject: 'Suspended account' })).toBe(
      'mailto:help@example.com?subject=Suspended%20account',
    );
  });

  it('drops the link for a missing or unsafe address, like the access-request link', () => {
    expect(supportMailto({ supportEmail: undefined, subject: 'x' })).toBeUndefined();
    expect(supportMailto({ supportEmail: 'a@b.com?bcc=evil@y.com', subject: 'x' })).toBeUndefined();
  });
});

describe('accessRequestMailto', () => {
  it('returns undefined when no support address is configured', () => {
    expect(accessRequestMailto(undefined)).toBeUndefined();
    expect(accessRequestMailto('')).toBeUndefined();
    expect(accessRequestMailto('   ')).toBeUndefined();
  });

  it('builds a mailto link with an encoded subject and body', () => {
    const link = accessRequestMailto('support@example.com');
    expect(link).toMatch(/^mailto:support@example\.com\?subject=Access%20request&body=/);
    expect(link).toContain(encodeURIComponent('I would like to request an account.'));
  });

  it('trims whitespace around the address', () => {
    expect(accessRequestMailto('  support@example.com ')).toMatch(/^mailto:support@example\.com\?/);
  });

  it('rejects an address carrying extra mailto query params (header injection)', () => {
    expect(accessRequestMailto('ops@x.com?subject=hi&bcc=evil@y.com')).toBeUndefined();
  });

  it('rejects an address carrying an embedded newline (header injection)', () => {
    expect(accessRequestMailto('ops@x.com\nbcc: evil@y.com')).toBeUndefined();
  });
});
