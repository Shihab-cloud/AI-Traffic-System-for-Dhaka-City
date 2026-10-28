import { validate } from 'class-validator';
import { IsValidIf } from './validation.decorator';

class Fixture {
  requireEmail!: boolean;

  @IsValidIf<Fixture>((obj) => !obj.requireEmail || typeof obj.email === 'string', {
    message: 'email is required when requireEmail is true',
  })
  email?: string;
}

describe('IsValidIf', () => {
  it('passes when the condition is satisfied', async () => {
    const f = new Fixture();
    f.requireEmail = true;
    f.email = 'a@b.com';
    expect(await validate(f)).toHaveLength(0);
  });

  it('fails when the condition is not satisfied', async () => {
    const f = new Fixture();
    f.requireEmail = true;
    f.email = undefined;
    const errors = await validate(f);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toMatchObject({
      isValidIf: 'email is required when requireEmail is true',
    });
  });

  it('passes when the condition makes the field optional', async () => {
    const f = new Fixture();
    f.requireEmail = false;
    expect(await validate(f)).toHaveLength(0);
  });
});
