import { plainToInstance } from 'class-transformer';

import { ExposeObjectId } from './base.res';

class Fixture {
  @ExposeObjectId()
  refId!: string;
}

describe('ExposeObjectId', () => {
  it('stringifies a Mongoose-ObjectId-shaped ref via toHexString', () => {
    const fakeObjectId = { toHexString: () => '507f1f77bcf86cd799439011' };
    const result = plainToInstance(Fixture, { refId: fakeObjectId });
    expect(result.refId).toBe('507f1f77bcf86cd799439011');
  });

  it('passes through a plain string unchanged', () => {
    const result = plainToInstance(Fixture, { refId: 'already-a-string' });
    expect(result.refId).toBe('already-a-string');
  });

  it('reports null instead of "[object Object]" for a non-ObjectId object', () => {
    const result = plainToInstance(Fixture, { refId: { unexpected: true } });
    expect(result.refId).toBeNull();
  });

  it('reports null for a missing ref', () => {
    const result = plainToInstance(Fixture, {});
    expect(result.refId).toBeNull();
  });
});
