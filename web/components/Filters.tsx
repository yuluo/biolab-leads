"use client";

import { useState } from "react";
import { FUNDING_OPTIONS, INDUSTRIES, US_STATES } from "@/lib/reference";

export type FilterValues = {
  state: string;
  min_participants: string;
  max_participants: string;
  funding_type: string;
  industry: string;
  q: string;
};

const INITIAL: FilterValues = {
  state: "",
  min_participants: "",
  max_participants: "",
  funding_type: "self-insured,partial",
  industry: "",
  q: "",
};

const fieldLabel =
  "block font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint mb-1.5";
const control =
  "w-full rounded-sm border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent";

export default function Filters({
  onSearch,
  disabled,
  loading,
}: {
  onSearch: (f: FilterValues) => void;
  disabled: boolean;
  loading: boolean;
}) {
  const [f, setF] = useState<FilterValues>(INITIAL);
  const set = (k: keyof FilterValues, v: string) => setF((p) => ({ ...p, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || loading) return;
    onSearch(f);
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-line bg-panel p-5 shadow-[0_1px_0_rgba(23,21,15,0.04),0_12px_30px_-24px_rgba(23,21,15,0.5)]"
    >
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <div className="col-span-2 lg:col-span-2">
          <label className={fieldLabel}>Employer name</label>
          <input
            value={f.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="search by name…"
            className={control}
          />
        </div>

        <div>
          <label className={fieldLabel}>State</label>
          <select value={f.state} onChange={(e) => set("state", e.target.value)} className={control}>
            <option value="">Any</option>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={fieldLabel}>Industry</label>
          <select value={f.industry} onChange={(e) => set("industry", e.target.value)} className={control}>
            {INDUSTRIES.map((i) => (
              <option key={i.label} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={fieldLabel}>Min employees</label>
          <input
            type="number"
            min={0}
            value={f.min_participants}
            onChange={(e) => set("min_participants", e.target.value)}
            placeholder="e.g. 500"
            className={`${control} tabular font-mono`}
          />
        </div>

        <div>
          <label className={fieldLabel}>Max employees</label>
          <input
            type="number"
            min={0}
            value={f.max_participants}
            onChange={(e) => set("max_participants", e.target.value)}
            placeholder="—"
            className={`${control} tabular font-mono`}
          />
        </div>

        <div className="col-span-2 lg:col-span-4">
          <label className={fieldLabel}>Funding type</label>
          <select
            value={f.funding_type}
            onChange={(e) => set("funding_type", e.target.value)}
            className={control}
          >
            {FUNDING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-2 flex items-end">
          <button
            type="submit"
            disabled={disabled || loading}
            className="group relative w-full overflow-hidden rounded-sm bg-accent-deep px-5 py-2.5 text-sm font-medium tracking-wide text-white transition-all hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              {loading ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse-dot" />
                  Searching
                </>
              ) : (
                <>Search →</>
              )}
            </span>
          </button>
        </div>
      </div>

      {disabled && (
        <p className="mt-3 font-mono text-xs text-amber">
          Add your authorized email and Apollo key above to search.
        </p>
      )}
    </form>
  );
}
