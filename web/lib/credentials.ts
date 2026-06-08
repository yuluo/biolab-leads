// Email + Apollo key kept in localStorage with a 24h expiry. After it lapses the
// user re-enters. This is a convenience store, not a vault — the key lives in the
// browser (XSS-exposed), acceptable for this bring-your-own-key tool.

export type Credentials = { email: string; apolloKey: string };
type Stored = Credentials & { expiresAt: number };

const KEY = "biolab_leads_creds";
export const TTL_MS = 24 * 60 * 60 * 1000;

export function saveCreds(c: Credentials): Stored {
  const stored: Stored = {
    email: c.email.trim().toLowerCase(),
    apolloKey: c.apolloKey.trim(),
    expiresAt: Date.now() + TTL_MS,
  };
  localStorage.setItem(KEY, JSON.stringify(stored));
  return stored;
}

export function loadCreds(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if (!s.email || !s.apolloKey || !s.expiresAt || Date.now() > s.expiresAt) {
      localStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function clearCreds() {
  localStorage.removeItem(KEY);
}

export function expiresInLabel(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / (60 * 60 * 1000));
  if (h >= 1) return `expires in ${h}h`;
  const m = Math.max(1, Math.floor(ms / (60 * 1000)));
  return `expires in ${m}m`;
}
