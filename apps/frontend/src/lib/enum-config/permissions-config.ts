import { PermissionsEnum } from '../enums/permission.enum';

export const PermissionsConfig: Record<
  PermissionsEnum,
  { name: PermissionsEnum; description: string }
> = {
  [PermissionsEnum.READ_USER]: {
    name: PermissionsEnum.READ_USER,
    description: 'View user accounts, profile details, and the roles assigned to each user',
  },
  [PermissionsEnum.CREATE_USER]: {
    name: PermissionsEnum.CREATE_USER,
    description: 'Invite or register new user accounts and assign their initial role',
  },
  [PermissionsEnum.UPDATE_USER]: {
    name: PermissionsEnum.UPDATE_USER,
    description:
      'Edit user profile fields, change assigned roles, and ban/unban or revoke sessions',
  },
  [PermissionsEnum.DELETE_USER]: {
    name: PermissionsEnum.DELETE_USER,
    description: 'Permanently remove user accounts and revoke all of their platform access',
  },
  [PermissionsEnum.CREATE_ROLE]: {
    name: PermissionsEnum.CREATE_ROLE,
    description: 'Define a new RBAC role with its own permission set and rank',
  },
  [PermissionsEnum.READ_ROLE]: {
    name: PermissionsEnum.READ_ROLE,
    description: 'Browse the role catalog and inspect the permissions each role grants',
  },
  [PermissionsEnum.UPDATE_ROLE]: {
    name: PermissionsEnum.UPDATE_ROLE,
    description:
      'Adjust permissions, rank, or name of an existing role (changes apply to every user holding it)',
  },
  [PermissionsEnum.DELETE_ROLE]: {
    name: PermissionsEnum.DELETE_ROLE,
    description: 'Retire a role that is no longer in use (only when no user is assigned to it)',
  },
  [PermissionsEnum.UPLOAD_FILE]: {
    name: PermissionsEnum.UPLOAD_FILE,
    description: 'Upload documents, images, or attachments into the platform file store',
  },
  [PermissionsEnum.READ_FILE]: {
    name: PermissionsEnum.READ_FILE,
    description: 'Download or preview files that have been uploaded to the system',
  },
  [PermissionsEnum.DELETE_FILE]: {
    name: PermissionsEnum.DELETE_FILE,
    description: 'Permanently remove uploaded files from storage',
  },
  [PermissionsEnum.INVALIDATE_TOKEN]: {
    name: PermissionsEnum.INVALIDATE_TOKEN,
    description:
      'Force-revoke active auth sessions or tokens (used for forced logout and security incidents)',
  },
  [PermissionsEnum.VALIDATE_TOKEN]: {
    name: PermissionsEnum.VALIDATE_TOKEN,
    description:
      'Programmatically verify whether an auth token is still active (used by service-to-service integrations)',
  },
  [PermissionsEnum.MANAGE_SUPPORT_TICKET]: {
    name: PermissionsEnum.MANAGE_SUPPORT_TICKET,
    description:
      'Open, reply to, assign, and change the status of support tickets across the workload queue',
  },
  [PermissionsEnum.READ_SUPPORT_TICKET]: {
    name: PermissionsEnum.READ_SUPPORT_TICKET,
    description: 'View support tickets, their message threads, and current status',
  },
  [PermissionsEnum.MANAGE_FAQ]: {
    name: PermissionsEnum.MANAGE_FAQ,
    description:
      'Author and publish the in-app FAQ — create, edit, reorder, publish, and delete entries',
  },
  [PermissionsEnum.ADMIN]: {
    name: PermissionsEnum.ADMIN,
    description: 'Marks the user as an Admin — implicit access to every platform feature.',
  },
  [PermissionsEnum.USER]: {
    name: PermissionsEnum.USER,
    description: 'Routes the user to the self-service surface as their default home view',
  },
  [PermissionsEnum.BROADCAST_NOTIFICATION]: {
    name: PermissionsEnum.BROADCAST_NOTIFICATION,
    description: 'Push platform-wide broadcast notifications to multiple users at once',
  },
  [PermissionsEnum.TRAFFIC_OFFICER]: {
    name: PermissionsEnum.TRAFFIC_OFFICER,
    description: 'Routes the user to the traffic personnel portal as their default home view',
  },
  [PermissionsEnum.READ_VIOLATION]: {
    name: PermissionsEnum.READ_VIOLATION,
    description: 'See detected violations, their evidence images and explanations',
  },
  [PermissionsEnum.ISSUE_TICKET]: {
    name: PermissionsEnum.ISSUE_TICKET,
    description: 'Correct plates, dismiss violations and send tickets to vehicle owners',
  },
  [PermissionsEnum.OPERATE_SURVEILLANCE]: {
    name: PermissionsEnum.OPERATE_SURVEILLANCE,
    description: 'Start and stop detection on cameras and videos, and upload videos',
  },
  [PermissionsEnum.TRACK_VEHICLE]: {
    name: PermissionsEnum.TRACK_VEHICLE,
    description: 'Follow a vehicle across cameras by plate and by multi-camera re-identification',
  },
  [PermissionsEnum.DECIDE_REVIEW]: {
    name: PermissionsEnum.DECIDE_REVIEW,
    description: 'Accept or reject review requests that vehicle owners file against tickets',
  },
  [PermissionsEnum.READ_REPORT]: {
    name: PermissionsEnum.READ_REPORT,
    description: 'See violation, ticket and payment statistics',
  },
  [PermissionsEnum.MANAGE_CAMERA]: {
    name: PermissionsEnum.MANAGE_CAMERA,
    description: 'Add cameras, draw their road zones and set speed limits and rules',
  },
  [PermissionsEnum.MANAGE_VEHICLE]: {
    name: PermissionsEnum.MANAGE_VEHICLE,
    description: 'Maintain the vehicle registry (registration number to owner)',
  },
  [PermissionsEnum.MANAGE_FINE]: {
    name: PermissionsEnum.MANAGE_FINE,
    description: 'Set the fine amount and due period of each violation type',
  },
  [PermissionsEnum.READ_AUDIT]: {
    name: PermissionsEnum.READ_AUDIT,
    description: 'Read the audit log of officer and admin actions',
  },
};

// Type validation to ensure all permissions have descriptions
type ValidatePermissions<T extends PermissionsEnum> = {
  [K in T]: K extends keyof typeof PermissionsConfig ? true : false;
}[T] extends true
  ? true
  : false;

// This will fail at compile time if any permission is missing
type AllPermissionsConfigured = ValidatePermissions<PermissionsEnum>;
