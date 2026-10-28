import { PermissionsEnum } from '@/lib/enums/permission.enum';

export const RouteUrls = {
  root: '/',
  unauthorized: '/unauthorized',
  notFound: '/not-found',
  faq: '/faq',
  auth: {
    signin: '/auth/signin',
    signup: '/auth/register',
    forgotPassword: '/auth/forgot-password',
    // The route segment is `/auth/reset-password/[token]`, but this value is a
    // *prefix* — `proxy.ts` public-path matching is `pathname.startsWith(p)`, so
    // the literal `[token]` here never matched a real link.
    resetPassword: '/auth/reset-password',
    acceptInvite: '/auth/accept-invite',
    changePassword: '/auth/change-password',
    accountBanned: '/auth/account-banned',
    accountTerminated: '/auth/account-terminated',
    mfaChallenge: '/auth/mfa-challenge',
    mfaSetup: '/auth/mfa-setup',
    activate: '/auth/activate',
    emailVerified: '/auth/email-verified',
  },
  dashboard: {
    /**
     * Placeholder landing path, not a real page. `proxy.ts` intercepts
     * `/dashboard` (and `/dashboard/*`) and rewrites it to the role-specific
     * dashboard once the session cookie exists. Auth pages redirect here rather
     * than computing a destination they have no role for yet: the sign-in and
     * sign-up responses carry no `role` (customSession injects it only on
     * getSession calls), so `defaultRedirectForPermissions(undefined)` would
     * send them to `/not-found`.
     */
    index: '/dashboard',
  },
  notifications: {
    inbox: '/notifications',
    settings: '/notifications/settings',
    compose: '/notifications/compose',
  },
  system: {
    index: '/system',
    roles: '/system/roles',
    userManagement: {
      index: '/system/user-management',
      profile: (userId: ID) => `/system/user-management/user/${userId}`,
    },
  },
  profile: {
    index: '/profile',
    accountSecurity: '/account-security',
  },
  officer: {
    dashboard: '/officer/dashboard',
    surveillance: '/officer/surveillance',
    passedVehicles: '/officer/passed-vehicles',
    track: '/officer/track',
    cases: '/officer/cases',
    reviews: '/officer/reviews',
  },
  /** The vehicle owner's page: their cases, evidence, review requests and payments. */
  myCases: '/my-cases',
  admin: {
    dashboard: '/admin/dashboard',
    cameras: '/admin/cameras',
    vehicles: '/admin/vehicles',
    fines: '/admin/fines',
    payments: '/admin/payments',
    audit: '/admin/audit',
    support: {
      index: '/admin/support',
      detail: (ticketId: ID) => `/admin/support/${ticketId}`,
    },
    faq: '/admin/faq',
    settings: {
      index: '/admin/settings',
      appConfig: '/admin/settings/app-config',
    },
  },
  terms: '/terms',
  privacyPolicy: '/privacy-policy',
};

const ADMIN_TIER_PERMISSIONS: readonly PermissionsEnum[] = [
  PermissionsEnum.ADMIN,
  PermissionsEnum.CREATE_ROLE,
  PermissionsEnum.DELETE_ROLE,
  PermissionsEnum.UPDATE_ROLE,
  PermissionsEnum.DELETE_USER,
  PermissionsEnum.INVALIDATE_TOKEN,
];

/**
 * Single source of truth for "where does this person land after signing in?".
 * Used by `proxy.ts` and every auth page that needs a post-login destination.
 *
 * Chosen by capability, not by role name. Roles are free-form rows editable at
 * runtime by any admin (`RoleCreationForm`), so switching on `RoleNameEnum` —
 * which only names the two seeded roles — stranded every custom-role user on
 * `/not-found` after login. Reading permissions instead answers the question
 * the redirect is actually asking, for any role however it was created.
 *
 * An empty or unrecognized permission set still lands on `/not-found` rather
 * than a real page — quietly granting the lowest-privilege surface would hide
 * an underlying session bug and risk showing data the holder has no claim to.
 */
export function defaultRedirectForPermissions(permissions?: PermissionsEnum[]): string {
  if (!permissions?.length) return RouteUrls.notFound;
  if (permissions.some((p) => ADMIN_TIER_PERMISSIONS.includes(p))) {
    return RouteUrls.admin.dashboard;
  }
  if (permissions.includes(PermissionsEnum.TRAFFIC_OFFICER)) return RouteUrls.officer.dashboard;
  if (permissions.includes(PermissionsEnum.USER)) return RouteUrls.myCases;
  return RouteUrls.profile.index;
}
