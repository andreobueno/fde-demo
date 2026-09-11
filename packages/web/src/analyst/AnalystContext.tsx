import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { getAnalysts } from '../api/client';
import type { Analyst, CurrentAnalyst } from '../api/types';
import { clearIdentity, getIdentity, subscribeIdentity } from '../api/identity';

interface AnalystContextValue {
  analystId: string;
  analyst: CurrentAnalyst | null;
  signOut: () => void;
  analysts: Analyst[];
  identitySignal: AbortSignal;
}

const AnalystContext = createContext<AnalystContextValue | null>(null);

export function AnalystProvider({ children }: { children: ReactNode }) {
  const identity = useSyncExternalStore(subscribeIdentity, getIdentity, () => null);
  const analystId = identity?.analyst.id ?? '';
  const signedOutSignal = useMemo(() => new AbortController().signal, []);
  const [analysts, setAnalysts] = useState<Analyst[]>([]);

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
      analystId, analyst: identity?.analyst ?? null, signOut: clearIdentity,
      analysts: identity ? analysts : [], identitySignal: identity?.signal ?? signedOutSignal,
    }),
    [analystId, analysts, identity, signedOutSignal],
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
