import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function SignInPage({
  pending,
  restoring = false,
  error,
  onSignIn,
  onCancel,
}: {
  pending: boolean;
  restoring?: boolean;
  error: string | null;
  onSignIn: (email: string, password: string) => Promise<void>;
  onCancel: () => void;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || restoring) return;
    const emailInput = event.currentTarget.elements.namedItem('email');
    const passwordInput = event.currentTarget.elements.namedItem('password');
    if (!(emailInput instanceof HTMLInputElement) || !(passwordInput instanceof HTMLInputElement))
      return;
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    passwordInput.value = '';
    void onSignIn(email, password);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white px-6 py-5 text-lg font-semibold tracking-tight">
        KYC Review Console
      </header>
      <main className="mx-auto max-w-lg px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-5 text-sm text-slate-600">
              Sign in with your email and password. Your role and permissions are verified by the
              server.
            </p>
            {restoring && (
              <p role="status" className="mb-4 text-sm">
                Restoring your session…
              </p>
            )}
            <form onSubmit={handleSubmit} className="space-y-4" aria-busy={pending || restoring}>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  disabled={pending || restoring}
                  aria-describedby="sign-in-help"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={pending || restoring}
                  aria-describedby="sign-in-help"
                />
              </div>
              <p id="sign-in-help" className="text-xs text-slate-500">
                Only your session token is saved in this tab’s sessionStorage, which is accessible
                to JavaScript. Refresh verifies your identity again. To switch users, sign out
                first. Separate localhost ports and independently opened tabs keep separate
                sessions.
              </p>
              {error && (
                <p
                  role="alert"
                  className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                >
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                {(pending || restoring) && (
                  <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" disabled={pending || restoring}>
                  {pending ? 'Signing in…' : restoring ? 'Restoring…' : 'Sign in'}
                </Button>
              </div>
            </form>
            {import.meta.env.DEV && (
              <section
                aria-labelledby="demo-heading"
                className="mt-6 border-t pt-5 text-sm text-slate-600"
              >
                <h2 id="demo-heading" className="font-semibold text-slate-900">
                  Local demo accounts
                </h2>
                <p className="mt-2">
                  Fictional accounts for local development only. Run{' '}
                  <code>npm run seed:logins</code> once after seeding, then{' '}
                  <code>npm run dev:server</code> to enable local demo authentication. This
                  authentication mode is rejected in production.
                </p>
                <ul className="my-3 space-y-2 break-words">
                  <li>
                    Analyst: <code>grete.lindholm@northwind-demo.example</code>
                  </li>
                  <li>
                    Senior analyst: <code>marta.ellison@northwind-demo.example</code>
                  </li>
                  <li>
                    Compliance manager: <code>sofia.chen@northwind-demo.example</code>
                  </li>
                </ul>
                <p>
                  Shared local demo password: <code>demo-password-2026</code>
                </p>
              </section>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
