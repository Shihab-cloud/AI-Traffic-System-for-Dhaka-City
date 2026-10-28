import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class PendingCredentialResponse {
  @ApiProperty({ description: 'User id' })
  @Expose()
  userId!: string;

  @ApiProperty({ description: 'Full display name' })
  @Expose()
  name!: string;

  @ApiProperty({ description: 'Username the user uses to sign in' })
  @Expose()
  username!: string;

  @ApiProperty({
    description:
      'Plaintext one-time password admin can distribute. Disappears the moment the user activates.',
  })
  @Expose()
  tempPassword!: string;

  @ApiProperty({ description: 'When the user record was created (sync time)' })
  @Expose()
  createdAt!: Date;
}

export class RegenerateCredentialResponse {
  @ApiProperty({ description: 'User id whose temp password was rotated' })
  @Expose()
  userId!: string;

  @ApiProperty({ description: 'Newly-issued plaintext temp password' })
  @Expose()
  tempPassword!: string;
}
