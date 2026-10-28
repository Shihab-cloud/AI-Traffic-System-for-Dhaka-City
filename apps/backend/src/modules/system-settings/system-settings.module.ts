import { Module } from '@nestjs/common';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsService } from './system-settings.service';

/**
 * Owns the instance-wide system settings singleton. Exports
 * `SystemSettingsService` so the better-auth provider (verification gate) and
 * the MFA module (enrollment gate) can consult the flags at runtime.
 *
 * Models come from the global SchemaModule — no forFeature here.
 */
@Module({
  controllers: [SystemSettingsController],
  providers: [SystemSettingsService],
  exports: [SystemSettingsService],
})
export class SystemSettingsModule {}
