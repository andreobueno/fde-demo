import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getAnalysts } from '../api/client';
import type { Analyst } from '../api/types';

const STORAGE_KEY = 'kyc.analystId';
export const DEFAULT_ANALYST_ID = 'ana-003';

interface AnalystContextValue {
  analystId: string;
  setAnalystId: (id: string) => void;
  analysts: Analyst[];
  identitySignal: AbortSignal;
}

const AnalystContext = createContext<AnalystContextValue | null>(null);

function loadStoredAnalystId(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && stored.length > 0 ? stored : DEFAULT_ANALYST_ID;
  } catch {
    return DEFAULT_ANALYST_ID;
  }
}

export function AnalystProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState(() => ({
    id: loadStoredAnalystId(),
    controller: new AbortController(),
  }));
  const analystId = identity.id;
  const [analysts, setAnalysts] = useState<Analyst[]>([]);

  useEffect(() => {
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
  }, [analystId]);

  const setAnalystId = useCallback((id: string) => {
    if (id === identity.id) {
      return;
    }
    identity.controller.abort();
    setIdentity({ id, controller: new AbortController() });
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // storage unavailable; session-only id
    }
  }, [identity]);

  const value = useMemo(
    () => ({ analystId, setAnalystId, analysts, identitySignal: identity.controller.signal }),
    [analystId, setAnalystId, analysts, identity],
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
