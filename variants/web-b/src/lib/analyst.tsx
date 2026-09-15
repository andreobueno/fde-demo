import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AuthSession, type AuthState } from './authSession';
import { SignInPage } from '@/pages/SignInPage';

interface AnalystContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}
const AnalystContext = createContext<AnalystContextValue | null>(null);
export function AnalystProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session] = useState(() => new AuthSession(queryClient, () => toast.dismiss()));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    void session.restore();
    return session.dispose;
  }, [session]);
  const value = { ...state, signIn: session.signIn, signOut: session.signOut };
  return (
    <AnalystContext.Provider value={value}>
      {state.status === 'authenticated' ? (
        <Fragment key={state.generation}>{children}</Fragment>
      ) : (
        <SignInPage
          key={state.generation}
          pending={state.status === 'signing_in'}
          restoring={state.status === 'restoring'}
          error={state.error}
          onSignIn={session.signIn}
          onCancel={() => void session.signOut()}
        />
      )}
    </AnalystContext.Provider>
  );
}
export function useAnalyst(): AnalystContextValue {
  const value = useContext(AnalystContext);
  if (!value) throw new Error('useAnalyst must be used inside AnalystProvider');
  return value;
}
