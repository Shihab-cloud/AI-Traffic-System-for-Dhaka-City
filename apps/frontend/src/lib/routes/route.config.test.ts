import { describe, expect, it } from 'vitest';

import { PermissionsEnum } from '@/lib/enums/permission.enum';
import { RouteUrls, defaultRedirectForPermissions } from './route.config';

describe('defaultRedirectForPermissions', () => {
  it('sends an admin-power permission set to the admin dashboard', () => {
    expect(defaultRedirectForPermissions([PermissionsEnum.ADMIN])).toBe(RouteUrls.admin.dashboard);
    expect(defaultRedirectForPermissions([PermissionsEnum.CREATE_ROLE])).toBe(
      RouteUrls.admin.dashboard,
    );
  });

  it('sends a non-admin custom-role permission set to profile — not /not-found', () => {
    expect(defaultRedirectForPermissions([PermissionsEnum.READ_SUPPORT_TICKET])).toBe(
      RouteUrls.profile.index,
    );
  });

  it('sends the seeded USER marker (vehicle owners) to their cases', () => {
    expect(defaultRedirectForPermissions([PermissionsEnum.USER])).toBe(RouteUrls.myCases);
  });

  it('sends traffic personnel to the violations dashboard', () => {
    expect(
      defaultRedirectForPermissions([PermissionsEnum.TRAFFIC_OFFICER, PermissionsEnum.READ_VIOLATION]),
    ).toBe(RouteUrls.officer.dashboard);
  });

  it('sends an empty or missing permission set to /not-found', () => {
    expect(defaultRedirectForPermissions([])).toBe(RouteUrls.notFound);
    expect(defaultRedirectForPermissions(undefined)).toBe(RouteUrls.notFound);
  });
});

describe('RouteUrls', () => {
  it('exposes the /dashboard placeholder the proxy rewrites', () => {
    // proxy.ts matches `pathname === '/dashboard' || pathname.startsWith('/dashboard/')`.
    expect(RouteUrls.dashboard.index).toBe('/dashboard');
  });

  it('exposes resetPassword as a prefix a real link matches', () => {
    // publicPaths in proxy.ts is matched with `pathname.startsWith(p)`.
    expect(RouteUrls.auth.resetPassword).toBe('/auth/reset-password');
    expect('/auth/reset-password/abc123'.startsWith(RouteUrls.auth.resetPassword)).toBe(true);
  });
});
