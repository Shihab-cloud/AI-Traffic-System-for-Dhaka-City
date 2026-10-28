import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

import { MIN_PASSWORD_LENGTH } from 'src/utils/password.util';

export class ActivateAccountRequest {
  @ApiProperty({
    description: 'New password to set on the account. Replaces the admin-issued temp password.',
    example: 'MyNewSecurePassword123',
    minLength: MIN_PASSWORD_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(MIN_PASSWORD_LENGTH)
  newPassword!: string;

  @ApiPropertyOptional({
    description:
      'Email to attach to the account. Required for users who do not already have one on file. ' +
      'Saved with `emailVerified=false`; a verification link is dispatched fire-and-forget. The ' +
      'address is only honored by password recovery once verified.',
    example: 'me@example.com',
  })
  @IsOptional()
  @IsEmail()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email?: string;
}
