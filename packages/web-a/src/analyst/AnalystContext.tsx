import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getAnalysts } from '../api/client';
import type { Analyst } from '../api/types';

const STORAGE_KEY = 'kyc.analystId';
const DEFAULT_ANALYST_ID = 'ana-001';

interface AnalystContextValue {
  analystId: string;
  setAnalystId: (id: string) => void;
  analysts: Analyst[];
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
  const [analystId, setAnalystIdState] = useState<string>(loadStoredAnalystId);
  const [analysts, setAnalysts] = useState<Analyst[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    getAnalysts(analystId, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) {
          setAnalysts(list);
        }
      })
      .catch(() => {
        // analyst list is non-critical; select still works with stored id
      });
    return () => {
      controller.abort();
    };
  }, [analystId]);

  const setAnalystId = (id: string) => {
    setAnalystIdState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // storage unavailable; session-only id
    }
  };

  const value = useMemo(
    () => ({ analystId, setAnalystId, analysts }),
    [analystId, analysts],
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
