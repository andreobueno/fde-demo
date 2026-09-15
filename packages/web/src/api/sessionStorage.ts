const KEY = 'operations.session';

export function storedSession(): string | null {
  try {
    const token = window.sessionStorage.getItem(KEY);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function storeSession(token: string | null): void {
  try {
    if (token) window.sessionStorage.setItem(KEY, token);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Browsers that disable storage can still use an in-memory session.
  }
}
