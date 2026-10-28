import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'EmailOrUsernameRequired', async: false })
class EmailOrUsernameRequiredConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as {
      email?: string | null;
      username?: string | null;
    };
    return Boolean(obj.email?.trim() || obj.username?.trim());
  }

  defaultMessage(): string {
    return 'Either email or username must be provided';
  }
}

/**
 * Class-level guard for DTOs where the caller may provide email OR username
 * (or both), but at least one is required. Apply with no target property:
 *
 *   @EmailOrUsernameRequired()
 *   class CreateUserDto { email?: string; username?: string; ... }
 */
export function EmailOrUsernameRequired(validationOptions?: ValidationOptions) {
  return function (target: object) {
    registerDecorator({
      target: target.constructor,
      propertyName: '__emailOrUsername',
      options: validationOptions,
      constraints: [],
      validator: EmailOrUsernameRequiredConstraint,
    });
  };
}
