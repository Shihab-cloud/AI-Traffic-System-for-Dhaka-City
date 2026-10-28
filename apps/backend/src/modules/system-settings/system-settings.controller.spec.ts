import 'reflect-metadata';

import { IS_PUBLIC_KEY } from 'src/lib/decorators/auth.decorator';
import { SystemSettingsController } from './system-settings.controller';

describe('SystemSettingsController', () => {
  it('marks getPublic (GET /system-settings/public) as @Public — no auth required', () => {
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      SystemSettingsController.prototype.getPublic,
    );

    expect(isPublic).toBe(true);
  });

  it('does not mark the admin-only get() and update() as public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SystemSettingsController.prototype.get)).not.toBe(
      true,
    );
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SystemSettingsController.prototype.update)).not.toBe(
      true,
    );
  });
});
