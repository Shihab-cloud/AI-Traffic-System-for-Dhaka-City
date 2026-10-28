import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

import { ApiProperty } from '@nestjs/swagger';

import { MIN_PASSWORD_LENGTH } from 'src/utils/password.util';

export class ProfileUpdateRequest {
  @ApiProperty({
    example: 'User',
  })
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty({
    example: 'User',
  })
  @IsNotEmpty()
  lastName!: string;

  @ApiProperty({
    example: 'user@example.com',
  })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value.toLowerCase())
  email!: string;

  @ApiProperty({
    example: '+1234567890',
  })
  @IsOptional()
  phone?: string;
}

export class PasswordUpdateRequest {
  @ApiProperty({
    example: 'admin123',
    required: false,
  })
  @IsOptional()
  oldPassword?: string;

  @ApiProperty({
    example: 'admin1234',
    minLength: MIN_PASSWORD_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(MIN_PASSWORD_LENGTH)
  newPassword!: string;
}
