'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { stepUpController } from '@/lib/utils/step-up-controller';
import type { MfaStepUpScope } from '@/lib/enums/mfa.enum';
import StepUpDialog from './StepUpDialog';

interface PendingState {
  id: number;
  scope: MfaStepUpScope;
  resolve: (token: string | null) => void;
}

/**
 * Mount near the top of the protected app layout. Registers a step-up handler
 * with the singleton controller; renders <StepUpDialog /> when the httpClient
 * interceptor needs to elicit a step-up token.
 *
 * One dialog at a time — a second request that needs step-up while one is open
 * is queued and opens once the current one resolves. Every entry is settled
 * exactly once, including on unmount: a caller left waiting on an unsettled
 * promise is a mutation stuck `isPending` with no way back.
 */
export default function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<PendingState | null>(null);
  // The queue and the entry being shown are refs, not state: they carry
  // `resolve` callbacks that must be invoked exactly once, and React may call a
  // state updater more than once per commit.
  const activeRef = useRef<PendingState | null>(null);
  const queueRef = useRef<PendingState[]>([]);
  const nextIdRef = useRef(0);

  const enqueue = useCallback((entry: PendingState) => {
    if (activeRef.current) {
      queueRef.current.push(entry);
      return;
    }
    activeRef.current = entry;
    setActive(entry);
  }, []);

  useEffect(() => {
    stepUpController.setHandler(
      (scope: MfaStepUpScope) =>
        new Promise<string | null>((resolve) => {
          enqueue({ id: nextIdRef.current++, scope, resolve });
        }),
    );
    return () => {
      stepUpController.clearHandler();
      activeRef.current?.resolve(null);
      for (const entry of queueRef.current) entry.resolve(null);
      activeRef.current = null;
      queueRef.current = [];
    };
  }, [enqueue]);

  const handleComplete = useCallback((token: string | null) => {
    activeRef.current?.resolve(token);
    const next = queueRef.current.shift() ?? null;
    activeRef.current = next;
    setActive(next);
  }, []);

  return (
    <>
      {children}
      {active && (
        // Keyed per entry, not per scope: two queued requests for the same
        // scope must each get a fresh dialog rather than inheriting the
        // previous challengeId and entered code.
        <StepUpDialog key={active.id} open scope={active.scope} onComplete={handleComplete} />
      )}
    </>
  );
}
