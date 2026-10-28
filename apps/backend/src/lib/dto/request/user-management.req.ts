import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { EmailOrUsernameRequired } from '../validators/email-or-username.validator';

@EmailOrUsernameRequired()
export class UserCreateRequest {
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

  @ApiPropertyOptional({
    example: 'john.doe@email.com',
    description: 'Required unless `username` is provided',
  })
  @IsOptional()
  @IsEmail()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  email?: string;

  @ApiProperty({
    example: 'admin123',
  })
  @IsOptional()
  @IsString()
  password!: string;

  @ApiProperty({
    example: '6777d0901106e93f3638d5c4',
  })
  @IsNotEmpty()
  @IsMongoId({ message: 'Role must be a valid MongoDB ObjectId' })
  roleId!: string;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  sendWelcomeEmail?: boolean;

  @ApiProperty({ example: 'john.doe', required: false })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_.-]+$/, {
    message: 'Username may contain letters, numbers, underscore, dot, hyphen',
  })
  @Transform(({ value, obj }: { value: unknown; obj: UserCreateRequest }) => {
    if (typeof value !== 'string') return value;
    obj.displayUsername = value;
    return value.toLowerCase();
  })
  username?: string;

  /** Populated by the `username` @Transform — preserves original casing for display. */
  displayUsername?: string;
}

export class UserUpdateRequest {
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
    example: 'john.doe@email.com',
  })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value.toLowerCase())
  email!: string;

  @ApiProperty({
    example: '6777d0901106e93f3638d5c4',
  })
  @IsNotEmpty()
  @IsMongoId({ message: 'Role must be a valid MongoDB ObjectId' })
  roleId!: string;

  @ApiProperty({ example: 'john.doe', required: false })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_.-]+$/, {
    message: 'Username may contain letters, numbers, underscore, dot, hyphen',
  })
  @Transform(({ value, obj }: { value: unknown; obj: UserUpdateRequest }) => {
    if (typeof value !== 'string') return value;
    obj.displayUsername = value;
    return value.toLowerCase();
  })
  username?: string;

  /** Populated by the `username` @Transform — preserves original casing for display. */
  displayUsername?: string;
}

export class AdminCreateRequest {
  @ApiProperty({
    example: 'admin@example.com',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'admin123',
  })
  @IsNotEmpty()
  password!: string;
}
