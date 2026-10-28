export enum PermissionsEnum {
  // User Management
  CREATE_USER = 'CREATE:USER',
  READ_USER = 'READ:USER',
  UPDATE_USER = 'UPDATE:USER',
  DELETE_USER = 'DELETE:USER',

  // Role Management
  CREATE_ROLE = 'CREATE:ROLE',
  READ_ROLE = 'READ:ROLE',
  UPDATE_ROLE = 'UPDATE:ROLE',
  DELETE_ROLE = 'DELETE:ROLE',

  // File Management
  UPLOAD_FILE = 'UPLOAD:FILE',
  // Reserved: declared and assignable in the role UI, but no guard checks these
  // yet — UPLOAD_FILE is the only enforced file permission. Wire them into the
  // download/delete endpoints before treating them as meaningful.
  READ_FILE = 'READ:FILE',
  DELETE_FILE = 'DELETE:FILE',

  // Token Management
  INVALIDATE_TOKEN = 'INVALIDATE:TOKEN',
  // Reserved: no guard in any app checks this — INVALIDATE_TOKEN is the only
  // enforced token permission.
  VALIDATE_TOKEN = 'VALIDATE:TOKEN',

  // Support Ticket Management
  MANAGE_SUPPORT_TICKET = 'MANAGE:SUPPORT_TICKET',
  READ_SUPPORT_TICKET = 'READ:SUPPORT_TICKET',

  // FAQ Management
  MANAGE_FAQ = 'MANAGE:FAQ',

  // Role markers (cross-app wire values — keep in sync across apps)
  ADMIN = 'ADMIN:ROOT',
  USER = 'USER:SELF_SERVICE',

  // Notification Management
  BROADCAST_NOTIFICATION = 'BROADCAST:NOTIFICATION',

  // Traffic enforcement
  TRAFFIC_OFFICER = 'TRAFFIC:OFFICER',
  READ_VIOLATION = 'READ:VIOLATION',
  ISSUE_TICKET = 'ISSUE:TICKET',
  OPERATE_SURVEILLANCE = 'OPERATE:SURVEILLANCE',
  TRACK_VEHICLE = 'TRACK:VEHICLE',
  DECIDE_REVIEW = 'DECIDE:REVIEW',
  READ_REPORT = 'READ:REPORT',
  MANAGE_CAMERA = 'MANAGE:CAMERA',
  MANAGE_VEHICLE = 'MANAGE:VEHICLE',
  MANAGE_FINE = 'MANAGE:FINE',
  READ_AUDIT = 'READ:AUDIT',
}

export const ALL_PERMISSIONS = Object.values(PermissionsEnum);

/** Traffic personnel (`TRAFFIC_OFFICER`): violations, tickets, surveillance, tracking, reviews. */
export const OFFICER_PERMISSIONS: PermissionsEnum[] = [
  PermissionsEnum.TRAFFIC_OFFICER,
  PermissionsEnum.READ_VIOLATION,
  PermissionsEnum.ISSUE_TICKET,
  PermissionsEnum.OPERATE_SURVEILLANCE,
  PermissionsEnum.TRACK_VEHICLE,
  PermissionsEnum.DECIDE_REVIEW,
  PermissionsEnum.READ_REPORT,
];
