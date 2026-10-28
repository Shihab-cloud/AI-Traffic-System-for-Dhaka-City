/**
 * Narrow seam for "a credential password just changed".
 *
 * `TokenService` writes the credential row and must revoke the device trust
 * that the old password established, but `MfaModule` imports `TokenModule` —
 * so depending on `MfaService` directly would close a cycle. `MfaModule`
 * registers itself under this token instead, and `TokenService` resolves it
 * lazily by token alone.
 */
export const MFA_PASSWORD_CHANGE_LISTENER = Symbol('MFA_PASSWORD_CHANGE_LISTENER');

export interface MfaPasswordChangeListener {
  onPasswordChanged(input: { userId: string }): Promise<void>;
}
