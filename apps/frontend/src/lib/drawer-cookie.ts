/**
 * Cookie holding a drawer's open/closed choice (`useDrawerState` writes it), so the server renders the drawer the way
 * the client will and hydration matches. Plain module: the server layout imports it.
 */
export const drawerCookieName = (key: string) => `drawer_state_${key}`;

export function parseDrawerCookie(value: string | undefined): boolean | null {
  return value === 'true' ? true : value === 'false' ? false : null;
}
