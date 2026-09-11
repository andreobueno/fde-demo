import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAnalystId, setAnalystId as persistAnalystId } from '@/api/client';

interface AnalystContextValue {
  analystId: string;
  setAnalystId: (id: string) => void;
}
const AnalystContext = createContext<AnalystContextValue | null>(null);
export function AnalystProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [analystId, setId] = useState(getAnalystId);
  const setAnalystId = (id: string) => {
    persistAnalystId(id);
    setId(id);
    void queryClient.invalidateQueries();
  };
  const value = { analystId, setAnalystId };
  return <AnalystContext.Provider value={value}>{children}</AnalystContext.Provider>;
}
export function useAnalyst(): AnalystContextValue {
  const value = useContext(AnalystContext);
  if (!value) throw new Error('useAnalyst must be used inside AnalystProvider');
  return value;
}
