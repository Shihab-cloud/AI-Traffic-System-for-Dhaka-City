import { describe, expect, it } from 'vitest';

import { userDisplayName } from './user.util';

describe('userDisplayName', () => {
  it('prefers name', () => {
    expect(userDisplayName({ name: 'Jane', fullName: 'Jane Doe', id: '1' })).toBe('Jane');
  });
  it('falls back to fullName', () => {
    expect(userDisplayName({ fullName: 'Jane Doe', id: '1' })).toBe('Jane Doe');
  });
  it('falls back to firstName + lastName', () => {
    expect(userDisplayName({ firstName: 'Jane', lastName: 'Doe', id: '1' })).toBe('Jane Doe');
  });
  it('falls back to a shortened id', () => {
    expect(userDisplayName({ id: 'abcdef123456' })).toBe('user …123456');
  });
  it('returns null for a missing user', () => {
    expect(userDisplayName(null)).toBeNull();
    expect(userDisplayName(undefined)).toBeNull();
  });
});
