import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { getAnalysts, restoreSession, signOut } from '../api/client';
import type { Analyst, CurrentAnalyst } from '../api/types';
import { getIdentity, subscribeIdentity } from '../api/identity';

interface AnalystContextValue {
  analystId: string;
  analyst: CurrentAnalyst | null;
  signOut: () => Promise<void>;
  restoring: boolean;
  authError: string | null;
  retryRestore: () => void;
  analysts: Analyst[];
  identitySignal: AbortSignal;
}

const AnalystContext = createContext<AnalystContextValue | null>(null);

export function AnalystProvider({ children }: { children: ReactNode }) {
  const identity = useSyncExternalStore(subscribeIdentity, getIdentity, () => null);
  const analystId = identity?.analyst.id ?? '';
  const signedOutSignal = useMemo(() => new AbortController().signal, []);
  const [analysts, setAnalysts] = useState<Analyst[]>([]);
  const [restoring, setRestoring] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setRestoring(true);
    setAuthError(null);
    restoreSession(controller.signal)
      .catch(() => {
        if (!controller.signal.aborted) setAuthError('Could not restore your session. Check the API server and retry.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setRestoring(false);
      });
    return () => controller.abort();
  }, [restoreAttempt]);

  useEffect(() => {
    setAnalysts([]);
    if (!identity) return;
    const controller = new AbortController();
    getAnalysts(analystId, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) {
          setAnalysts(list);
        }
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [analystId, identity]);

  const value = useMemo(
    () => ({
      analystId, analyst: identity?.analyst ?? null,
      signOut: async () => {
        setAuthError(null);
        try {
          await signOut();
        } catch {
          setAuthError('Signed out of this tab, but server revocation failed. The session may remain valid until it expires.');
        }
      },
      restoring, authError, retryRestore: () => setRestoreAttempt((attempt) => attempt + 1),
      analysts: identity ? analysts : [], identitySignal: identity?.signal ?? signedOutSignal,
    }),
    [analystId, analysts, identity, signedOutSignal, restoring, authError],
  );

  return <AnalystContext.Provider value={value}>{children}</AnalystContext.Provider>;
}

export function useAnalyst(): AnalystContextValue {
  const ctx = useContext(AnalystContext);
  if (!ctx) {
    throw new Error('useAnalyst must be used inside AnalystProvider');
  }
  return ctx;
}
