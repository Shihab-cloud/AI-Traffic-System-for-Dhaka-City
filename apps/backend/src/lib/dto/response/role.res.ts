import { BaseResponse, PaginatedResponse } from 'src/lib/dto/response/base.res';
import { Expose, Type } from 'class-transformer';

import { ApiProperty } from '@nestjs/swagger';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';

export class RoleResponse extends BaseResponse {
  @ApiProperty()
  @Expose()
  name!: string;

  @ApiProperty()
  @Expose()
  description?: string;

  @ApiProperty({ type: String, isArray: true, enum: PermissionsEnum })
  @Expose()
  permissions!: PermissionsEnum[];

  @ApiProperty()
  @Expose()
  isDefault!: boolean;

  @ApiProperty({
    description: 'Hierarchy rank for the role. Lower number = higher rank (super admin = 0).',
  })
  @Expose()
  rank!: number;
}

export class PaginatedRoleResponse extends PaginatedResponse<RoleResponse> {
  @ApiProperty({ type: RoleResponse, isArray: true })
  @Type(() => RoleResponse)
  docs!: RoleResponse[];
}
