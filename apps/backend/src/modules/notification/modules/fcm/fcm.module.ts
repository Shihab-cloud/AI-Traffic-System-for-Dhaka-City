import { Module } from '@nestjs/common';
import { DeviceTokenService } from './device-token.service';
import { FcmService } from './fcm.service';

// Models come from the global SchemaModule — no forFeature here.
@Module({
  providers: [FcmService, DeviceTokenService],
  exports: [FcmService, DeviceTokenService],
})
export class FcmModule {}
