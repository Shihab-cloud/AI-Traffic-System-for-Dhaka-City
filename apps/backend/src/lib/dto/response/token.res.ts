import { Expose, Type } from 'class-transformer';

import { ApiProperty } from '@nestjs/swagger';

export class TokenResponse {
  constructor(args: Partial<TokenResponse>) {
    Object.assign(this, args);
  }

  @ApiProperty()
  @Expose()
  accessToken!: string;

  @ApiProperty()
  @Expose()
  refreshToken!: string;

  @ApiProperty()
  @Expose()
  @Type(() => Number)
  expiresIn!: number;
}
