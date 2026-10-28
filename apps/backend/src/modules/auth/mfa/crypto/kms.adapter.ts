/**
 * KmsAdapter — abstracts key custody behind a swappable boundary.
 *
 * Day-1 implementation: env-var KEK (`MFA_KEK_B64`).
 * Phase-2: AWS KMS (GenerateDataKey + Decrypt) without changing call sites.
 *
 * Envelope encryption contract:
 *   - `wrap(plaintextDek)` returns the wrapped DEK (opaque to callers).
 *   - `unwrap(wrappedDek, kekId)` returns the plaintext DEK to be used for one
 *     AES-256-GCM operation, then discarded.
 *
 * Sub-key derivation (HKDF) is exposed for callers that sign artifacts (step-up
 * tokens, trusted-device cookies). Callers MUST pass a stable `info` string.
 */
export interface KmsAdapter {
  /** Identifier of the active KEK. Persisted alongside ciphertext for key rotation. */
  readonly activeKekId: string;

  /** Wrap a freshly-generated 32-byte DEK with the active KEK. */
  wrap(plaintextDek: Buffer): Promise<{ wrapped: string; kekId: string }>;

  /** Unwrap a stored DEK ciphertext using the KEK identified by `kekId`. */
  unwrap(wrappedDek: string, kekId: string): Promise<Buffer>;

  /**
   * Derive a 32-byte sub-key from the active KEK using HKDF-SHA256.
   * `info` is a stable label (e.g. `step_up_v1`, `trusted_device_v1`).
   * Same `info` always returns the same sub-key for the same KEK.
   */
  deriveSubKey(info: string, length?: number): Promise<Buffer>;
}
