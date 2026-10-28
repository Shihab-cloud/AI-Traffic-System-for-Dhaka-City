import type { MfaStepUpScope } from '@/lib/enums/mfa.enum';

/**
 * StepUpController — singleton bridge between the httpClient interceptor and
 * the StepUpDialog UI.
 *
 * Lifecycle:
 *   - StepUpProvider (mounted in the protected app layout) calls
 *     `setHandler(fn)` on mount with a function that opens the dialog and
 *     resolves with the issued token (or null on cancel).
 *   - httpClient interceptor calls `await requireStepUp(scope)` when it sees
 *     a 401 step_up_required response. The promise resolves with the token
 *     to retry, or rejects with `StepUpCancelled` if the user dismisses.
 *
 * Concurrency: each call gets its own pending promise. The handler function
 * is responsible for showing the dialog one-at-a-time (it can queue).
 */

export class StepUpCancelled extends Error {
  constructor() {
    super('Step-up was cancelled by the user');
    this.name = 'StepUpCancelled';
  }
}

export class StepUpUnavailable extends Error {
  constructor() {
    super('Step-up handler is not registered (StepUpProvider missing?)');
    this.name = 'StepUpUnavailable';
  }
}

type Handler = (scope: MfaStepUpScope) => Promise<string | null>;

class Controller {
  private handler: Handler | null = null;

  setHandler(fn: Handler) {
    this.handler = fn;
  }

  clearHandler() {
    this.handler = null;
  }

  async requireStepUp(scope: MfaStepUpScope): Promise<string> {
    if (!this.handler) throw new StepUpUnavailable();
    const token = await this.handler(scope);
    if (token === null) throw new StepUpCancelled();
    return token;
  }
}

export const stepUpController = new Controller();
