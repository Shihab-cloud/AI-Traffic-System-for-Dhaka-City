import { ValidationArguments, ValidationOptions, registerDecorator } from 'class-validator';

export function IsValidIf<T>(
  condition: (obj: T) => boolean,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [condition],
      validator: {
        validate(_: unknown, args: ValidationArguments): boolean {
          const [cond] = args.constraints as [(obj: T) => boolean];
          return cond(args.object as T);
        },
        defaultMessage(): string {
          return 'validation failed';
        },
      },
      name: 'isValidIf',
    });
  };
}
