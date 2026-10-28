// Mirror of backend src/shared/enums/role-name.enum.ts — RoleNameEnum.
// Values match what Better Auth stores on the role row and emits in the session.
// Seeded roles: ADMIN (platform admin), TRAFFIC_OFFICER (traffic personnel) and USER (vehicle owner).
export enum RoleNameEnum {
  ADMIN = 'ADMIN',
  TRAFFIC_OFFICER = 'TRAFFIC_OFFICER',
  USER = 'USER',
}
