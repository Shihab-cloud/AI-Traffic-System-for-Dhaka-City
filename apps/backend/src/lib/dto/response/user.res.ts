import { Expose, Type } from 'class-transformer';
import { BaseResponse, PaginatedResponse } from 'src/lib/dto/response/base.res';

import { ApiProperty } from '@nestjs/swagger';
import { RoleResponse } from 'src/lib/dto/response/role.res';
import { UserStatusEnum } from 'src/shared/enums/status.enum';

export class UserResponse extends BaseResponse {
  @ApiProperty()
  @Expose()
  get fullName(): string {
    return [this.firstName, this.lastName].filter(Boolean).join(' ') || '';
  }

  @ApiProperty()
  @Expose()
  name!: string;

  @ApiProperty()
  @Expose()
  firstName!: string;

  @ApiProperty()
  @Expose()
  lastName!: string;

  @ApiProperty()
  @Expose()
  email!: string;

  @ApiProperty({ required: false })
  @Expose()
  username?: string | null;

  @ApiProperty({ required: false })
  @Expose()
  displayUsername?: string | null;

  @ApiProperty()
  @Expose()
  image?: string;

  @ApiProperty()
  @Expose()
  phone?: string;

  @ApiProperty({ enum: UserStatusEnum })
  @Expose()
  status!: UserStatusEnum;

  @ApiProperty({ type: RoleResponse })
  @Expose()
  @Type(() => RoleResponse)
  role!: RoleResponse;

  @ApiProperty({
    description: 'True when the user has at least one active MFA factor.',
  })
  @Expose()
  mfaEnabled?: boolean;
}

export class PaginatedUserResponse extends PaginatedResponse<UserResponse> {
  @ApiProperty({ type: UserResponse, isArray: true })
  @Type(() => UserResponse)
  docs!: UserResponse[];
}

export class TempPasswordResponse {
  @ApiProperty({
    description:
      'Newly-generated plaintext temp password. Returned exactly once — not stored anywhere recoverable.',
  })
  @Expose()
  tempPassword!: string;
}

/**
 * Response for the one-time bootstrap-admin route.
 *
 * Carries the generated password, which exists nowhere else — it is hashed on
 * write and never recoverable. The route that returns this is `@Public()`, so
 * it is deliberately a distinct type from `UserResponse`: nothing else should
 * be able to return a plaintext password by accident.
 */
export class AdminBootstrapResponse {
  @ApiProperty({ type: UserResponse })
  @Expose()
  @Type(() => UserResponse)
  user!: UserResponse;

  @ApiProperty({
    description: 'Generated password, shown once. Capture it now — it is not stored.',
  })
  @Expose()
  password!: string;
}
