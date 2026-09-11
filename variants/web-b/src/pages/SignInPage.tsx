import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function SignInPage({
  pending,
  error,
  onSignIn,
  onCancel,
}: {
  pending: boolean;
  error: string | null;
  onSignIn: (token: string) => Promise<void>;
  onCancel: () => void;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('access-token');
    if (!(input instanceof HTMLInputElement)) return;
    const token = input.value.trim();
    input.value = '';
    void onSignIn(token);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white px-6 py-5 text-lg font-semibold tracking-tight">
        KYC Review Console
      </header>
      <main className="mx-auto max-w-md px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-5 text-sm text-slate-600">
              Enter the access token provided by your administrator. Tokens expire after eight hours
              and may be revoked.
            </p>
            <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="access-token" className="text-sm font-medium">
                  Access token
                </label>
                <Input
                  id="access-token"
                  name="access-token"
                  type="password"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  minLength={43}
                  maxLength={43}
                  pattern="[A-Za-z0-9_-]{43}"
                  disabled={pending}
                  aria-describedby="sign-in-help"
                />
              </div>
              <p id="sign-in-help" className="text-xs text-slate-500">
                Your token stays in memory only. Reloading or signing out requires signing in again.
                To switch users, sign out and enter that user’s token.
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
                {pending && (
                  <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" disabled={pending}>
                  {pending ? 'Verifying…' : 'Sign in'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
