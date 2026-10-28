import { AmrEnum } from '../../shared/enums/auth.enum';

export interface JwtRole {
  id: string;
  name: string;
  permissions: string[];
  rank: number;
}

/**
 * Authentication Assurance Level.
 *   - 1 : password only
 *   - 2 : password + MFA factor (or trusted-device cookie)
 *
 * Existing JWTs minted before MFA shipped have no `aal` claim; treat as 1.
 */
export type Aal = 1 | 2;

export interface JwtPayload {
  sub: string;
  /** Absent when the user signed in via username and has no email on file. */
  email?: string;
  role: JwtRole | null;
  iat: number;
  exp: number;
  iss?: string;
  aud?: string;
  /** Better Auth session id this JWT belongs to. Used for step-up token binding. */
  sid?: string;
  aal?: Aal;
  amr?: AmrEnum[];
  /** Unix seconds when the most recent MFA challenge was satisfied. */
  mfa_at?: number;
  /**
   * True when the user holds an admin-class permission, has no active MFA factor,
   * and is signed in within the grace period. Frontend redirects to /auth/mfa-setup.
   */
  enrollment_required?: boolean;
  /**
   * True when the user is admin-provisioned and must complete activation
   * (change temp password, optionally add email) before reaching app routes.
   * Frontend redirects to /auth/activate.
   */
  activation_required?: boolean;
}
