export const QUERY_KEYS = {
  user: {
    getUser: 'user.getUser',
    getProfile: 'user.getProfile',
  },
  role: {
    getRoleList: 'role.getRoleList',
    getRole: 'role.getRole',
  },
  permission: {
    getPermissionList: 'permission.getPermissionList',
    getPermission: 'permission.getPermission',
  },
  userManagement: {
    getUser: 'userManagement.getUser',
    getUserList: 'userManagement.getUsers',
  },
  supportTicket: {
    getList: 'supportTicket.getList',
    getMyList: 'supportTicket.getMyList',
    getDetail: 'supportTicket.getDetail',
  },
  faq: {
    list: 'faq.list',
    listMe: 'faq.listMe',
    listAll: 'faq.listAll',
    categories: 'faq.categories',
  },
  notification: {
    getInbox: 'notification.getInbox',
    getUnreadCount: 'notification.getUnreadCount',
    getUserSettings: 'notification.getUserSettings',
    getUserSettingsChannels: 'notification.getUserSettingsChannels',
  },
  mfa: {
    factors: 'mfa.factors',
    backupRemaining: 'mfa.backupRemaining',
    trustedDevices: 'mfa.trustedDevices',
  },
  systemSettings: {
    get: 'systemSettings.get',
    getPublic: 'systemSettings.getPublic',
  },
};
