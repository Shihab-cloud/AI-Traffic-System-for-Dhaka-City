import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';

export class RoleCreationRequest {
  @ApiProperty({
    example: 'admin',
    description: 'Unique name of the role',
    minLength: 3,
    maxLength: 50,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(50)
  name!: string;

  @ApiProperty({
    example: 'Administrator role with full access',
    description: 'Description of the role and its purpose',
    required: false,
  })
  @IsString()
  @MaxLength(200)
  description!: string;

  @ApiProperty({
    example: [PermissionsEnum.READ_USER, PermissionsEnum.UPDATE_USER],
    description: 'Array of permissions assigned to the role',
    enum: PermissionsEnum,
    isArray: true,
  })
  @IsArray()
  @IsEnum(PermissionsEnum, { each: true })
  @IsNotEmpty()
  permissions!: PermissionsEnum[];

  @ApiProperty({
    example: 20,
    description:
      'Hierarchy rank for the role. Lower number = higher rank (super admin = 0). Used to gate destructive ops between admins.',
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  rank!: number;
}
