"use client";

import { useEffect, useState } from "react";
import {
  Credentials,
  clearCreds,
  expiresInLabel,
  loadCreds,
  saveCreds,
} from "@/lib/credentials";

export default function SettingsBar({
  onChange,
}: {
  onChange: (creds: Credentials | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [apolloKey, setApolloKey] = useState("");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const c = loadCreds();
    if (c) {
      setEmail(c.email);
      setApolloKey(c.apolloKey);
      setExpiresAt(c.expiresAt);
      onChange({ email: c.email, apolloKey: c.apolloKey });
    } else {
      setEditing(true);
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@") || apolloKey.trim().length < 4) return;
    const s = saveCreds({ email, apolloKey });
    setExpiresAt(s.expiresAt);
    setEditing(false);
    onChange({ email: s.email, apolloKey: s.apolloKey });
  }

  function forget() {
    clearCreds();
    setExpiresAt(null);
    setApolloKey("");
    setEditing(true);
    onChange(null);
  }

  if (!ready) return <div className="h-[58px] border-b border-line" />;

  const maskedKey = apolloKey ? `${apolloKey.slice(0, 3)}····${apolloKey.slice(-2)}` : "";

  return (
    <div className="border-b border-line bg-panel/70 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          Access
        </span>

        {editing ? (
          <form onSubmit={save} className="flex flex-1 flex-wrap items-center gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="authorized@email.com"
              className="min-w-[200px] flex-1 rounded-sm border border-line bg-paper px-3 py-1.5 font-mono text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent"
            />
            <input
              type="password"
              required
              value={apolloKey}
              onChange={(e) => setApolloKey(e.target.value)}
              placeholder="Apollo API key"
              className="min-w-[200px] flex-1 rounded-sm border border-line bg-paper px-3 py-1.5 font-mono text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent"
            />
            <button
              type="submit"
              className="rounded-sm bg-accent px-4 py-1.5 text-sm font-medium text-paper transition-colors hover:bg-accent-deep"
            >
              Save
            </button>
          </form>
        ) : (
          <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-2 font-mono text-sm text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {email}
            </span>
            <span className="font-mono text-xs text-ink-faint">key {maskedKey}</span>
            {expiresAt && (
              <span className="font-mono text-xs text-amber">{expiresInLabel(expiresAt)}</span>
            )}
            <div className="ml-auto flex items-center gap-3">
              <button
                onClick={() => setEditing(true)}
                className="text-sm text-ink-soft underline-offset-4 hover:text-accent hover:underline"
              >
                Change
              </button>
              <button
                onClick={forget}
                className="text-sm text-ink-soft underline-offset-4 hover:text-danger hover:underline"
              >
                Forget
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
