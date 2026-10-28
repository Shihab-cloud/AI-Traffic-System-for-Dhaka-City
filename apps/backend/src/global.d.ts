import { CurrentUser } from './lib/decorators/user.decorator';

// add user to core.Express Request interface
declare module 'express' {
  interface Request extends core.Request {
    user: CurrentUser;
  }
}
