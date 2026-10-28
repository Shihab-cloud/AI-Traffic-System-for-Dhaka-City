// __dirname already resolves to `.../mail/templates/password` (both in source
// and in the dist build, where nest-cli copies *.ejs alongside the compiled JS).
// Previously this prefixed an extra `/templates/password/` segment, which broke
// every template in this file — e.g. the magic-link invite.
const BASE = __dirname;

export const PASSWORD_TEMPLATE_FILE_PATH = {
  WELCOME: `${BASE}/welcome`,
  PASSWORD_RESET: `${BASE}/password-reset`,
  FIRST_LOGIN: `${BASE}/first-login`,
  MAGIC_LINK: `${BASE}/magic-link`,
  VERIFY_EMAIL: `${BASE}/verify-email`,
};
