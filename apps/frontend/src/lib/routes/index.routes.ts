import { PermissionsEnum } from '@/lib/enums/permission.enum';
import { RouteUrls } from '@/lib/routes/route.config';
import { ElementType } from 'react';
import { Icons, type IconType } from '@/lib/icons';

export interface SidebarItem {
  link: string;
  text: string;
  icon: IconType;
  permissions?: PermissionsEnum[];
  child?: SidebarGroup;
}

export interface SidebarGroup {
  header?: string;
  items: SidebarItem[];
  permissions?: PermissionsEnum[];
}

type SubSidebarSubSectionType = {
  title: string;
  link: string;
  icon: ElementType;
};

export type SubSidebarSectionType = {
  title: string;
  link: string;
  subtitle: string;
  icon: ElementType;
  childrenKey?: string;
  children?: SubSidebarSubSectionType[];
};

// ─── Sidebar groups ───────────────────────────────────────────────────────────
// One constant per group, and the exported composition line below *is* the
// display order. Each group's rationale sits on its own const rather than being
// buried in a factory's return array.
//
// Group `permissions` mirror the route group's own guard so a link is never
// offered for a page that will refuse it. The whole `(admin)` route group is
// guarded by `ROUTE_AUDIENCE_PERMISSION[RoleNameEnum.ADMIN]` (= `ADMIN`) in
// `app/(protected)/(admin)/layout.tsx`, so `[ADMIN]` at the group level is the
// exact match — do not narrow these to granular permissions, or an admin without
// the granular one loses a link to a page they can open.

/** Traffic personnel: the violation feed and the tools around it. Admins hold the marker too. */
const officerGroup: SidebarGroup = {
  header: 'Traffic Enforcement',
  permissions: [PermissionsEnum.TRAFFIC_OFFICER],
  items: [
    { link: RouteUrls.officer.dashboard, text: 'Violations', icon: Icons.dashboard },
    { link: RouteUrls.officer.surveillance, text: 'Surveillance', icon: Icons.surveillance },
    { link: RouteUrls.officer.passedVehicles, text: 'Passed Vehicles', icon: Icons.passedVehicles },
    { link: RouteUrls.officer.track, text: 'Track', icon: Icons.track },
    { link: RouteUrls.officer.cases, text: 'Tickets', icon: Icons.cases },
    { link: RouteUrls.officer.reviews, text: 'Review Requests', icon: Icons.reviews },
  ],
};

/** Vehicle owners (the default USER role). */
const ownerGroup: SidebarGroup = {
  header: 'My Vehicles',
  permissions: [PermissionsEnum.USER],
  items: [{ link: RouteUrls.myCases, text: 'My Cases', icon: Icons.vehicle }],
};

const adminGroup: SidebarGroup = {
  header: 'Admin',
  permissions: [PermissionsEnum.ADMIN],
  items: [
    { link: RouteUrls.admin.dashboard, text: 'Overview', icon: Icons.overview },
    { link: RouteUrls.admin.cameras, text: 'Cameras & Zones', icon: Icons.camera },
    { link: RouteUrls.admin.vehicles, text: 'Vehicle Registry', icon: Icons.vehicle },
    { link: RouteUrls.admin.fines, text: 'Fines', icon: Icons.fines },
    { link: RouteUrls.admin.payments, text: 'Payments', icon: Icons.payments },
    { link: RouteUrls.admin.audit, text: 'Audit Log', icon: Icons.audit },
    {
      link: RouteUrls.admin.support.index,
      text: 'Support Tickets',
      icon: Icons.support,
    },
    {
      link: RouteUrls.admin.faq,
      text: 'FAQ',
      icon: Icons.faq,
    },
    {
      link: RouteUrls.admin.settings.appConfig,
      text: 'App Settings',
      icon: Icons.appSettings,
    },
  ],
};

/** Ungated: every signed-in user has a profile and their own security settings. */
const profileGroup: SidebarGroup = {
  header: 'Profile',
  items: [
    {
      link: RouteUrls.profile.index,
      text: 'Profile',
      icon: Icons.profile,
    },
    {
      link: RouteUrls.profile.accountSecurity,
      text: 'Account and Security',
      icon: Icons.security,
    },
  ],
};

const systemGroup: SidebarGroup = {
  header: 'System',
  permissions: [PermissionsEnum.ADMIN],
  items: [
    {
      link: RouteUrls.system.roles,
      text: 'Roles & Permissions',
      icon: Icons.roles,
    },
    {
      link: RouteUrls.system.userManagement.index,
      text: 'User Management',
      icon: Icons.users,
    },
  ],
};

/*
 * No group permission: the two items answer to different ones. Everyone has
 * notification preferences; the composer is the broadcast surface and its own
 * layout guards on BROADCAST_NOTIFICATION, so the item declares the same.
 */
const notificationsGroup: SidebarGroup = {
  header: 'Notifications',
  items: [
    {
      link: RouteUrls.notifications.settings,
      text: 'Notification Settings',
      icon: Icons.notificationPreferences,
    },
    {
      link: RouteUrls.notifications.compose,
      text: 'Notification Composer',
      icon: Icons.notificationComposer,
      permissions: [PermissionsEnum.BROADCAST_NOTIFICATION],
    },
  ],
};

/** The whole sidebar, in display order. Per-group visibility is decided by `permissions`. */
export const SIDEBAR_GROUPS: SidebarGroup[] = [
  officerGroup,
  ownerGroup,
  adminGroup,
  profileGroup,
  systemGroup,
  notificationsGroup,
];
