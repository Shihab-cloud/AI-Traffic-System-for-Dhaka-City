import { AccountSchema } from './account.schema';

describe('accounts schema indexes', () => {
  it('declares the partial unique credential index Mongoose will build', () => {
    const match = AccountSchema.indexes().find(
      ([, options]) => (options as { name?: string }).name === 'uniq_credential_account_per_user',
    );

    expect(match).toBeDefined();
    const [fields, options] = match!;
    expect(fields).toEqual({ userId: 1, providerId: 1 });
    expect(options).toMatchObject({
      unique: true,
      partialFilterExpression: { providerId: 'credential' },
    });
  });

  it('targets better-auth’s collection, not a pluralised model name', () => {
    expect(AccountSchema.get('collection')).toBe('accounts');
  });
});
