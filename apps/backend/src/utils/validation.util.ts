import { ValidationError } from 'class-validator';

export function flattenValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((error) => {
      const constraints = error.constraints;
      if (constraints) {
        return Object.values(constraints).join(', ');
      }
      return String(flattenValidationErrors(error.children || []));
    })
    .join(', ');
}
