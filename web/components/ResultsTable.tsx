"use client";

import { Contact, Employer } from "@/lib/api";
import { FUNDING_LABELS } from "@/lib/reference";

export type Row = {
  employer: Employer;
  contacts: Contact[] | null; // null = still resolving
  reason?: string;
  error?: string;
};

function fundingClasses(ft: string): string {
  switch (ft) {
    case "self-insured":
      return "border-accent/30 bg-accent-wash text-accent-deep";
    case "partial":
      return "border-amber/30 bg-amber/10 text-amber";
    case "fully-insured":
      return "border-line-strong bg-paper-2 text-ink-soft";
    default:
      return "border-line bg-paper-2 text-ink-faint";
  }
}

function ContactCell({ row }: { row: Row }) {
  if (row.error) {
    return <span className="font-mono text-xs text-danger">{row.error}</span>;
  }
  if (row.contacts === null) {
    return (
      <span className="flex items-center gap-2 font-mono text-xs text-ink-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
        resolving…
      </span>
    );
  }
  if (row.contacts.length === 0) {
    return (
      <span className="font-mono text-xs text-ink-faint">
        {row.reason === "trust_fund_skipped"
          ? "trust / fund — skipped"
          : row.reason === "no_org_match"
            ? "no org match"
            : "no contact found"}
      </span>
    );
  }
  return (
    <ul className="space-y-2">
      {row.contacts.map((c, i) => (
        <li key={`${c.contact_email}-${i}`} className="leading-tight">
          <div className="text-sm font-medium text-ink">{c.contact_name}</div>
          {c.contact_title && (
            <div className="text-xs text-ink-soft">{c.contact_title}</div>
          )}
          <div className="mt-0.5 flex items-center gap-3">
            <a
              href={`mailto:${c.contact_email}`}
              className="font-mono text-xs text-accent-deep underline-offset-2 hover:underline"
            >
              {c.contact_email}
            </a>
            {c.contact_linkedin && (
              <a
                href={c.contact_linkedin}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[10px] uppercase tracking-wider text-ink-faint hover:text-accent"
              >
                in↗
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

const th =
  "px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-faint";
const td = "px-4 py-4 align-top border-t border-line";

export default function ResultsTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel">
      <table className="w-full min-w-[860px] border-collapse">
        <thead>
          <tr className="bg-paper-2/60">
            <th className={th}>Employer</th>
            <th className={th}>Location</th>
            <th className={`${th} text-right`}>Employees</th>
            <th className={th}>Funding</th>
            <th className={`${th} min-w-[280px]`}>Benefits contacts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const e = row.employer;
            return (
              <tr
                key={e.ein}
                className="animate-rise transition-colors hover:bg-paper-2/40"
                style={{ animationDelay: `${Math.min(idx, 9) * 35}ms` }}
              >
                <td className={td}>
                  <div className="font-display text-[15px] leading-snug text-ink">
                    {e.sponsor_name}
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-ink-faint">
                    <span>EIN {e.ein}</span>
                    {e.business_code && <span>· NAICS {e.business_code}</span>}
                    {e.latest_plan_year && <span>· {e.latest_plan_year}</span>}
                  </div>
                </td>
                <td className={`${td} text-sm text-ink-soft`}>
                  {e.city ? `${titleCase(e.city)}, ` : ""}
                  <span className="font-mono">{e.state || "—"}</span>
                </td>
                <td className={`${td} text-right`}>
                  <span className="tabular font-mono text-sm text-ink">
                    {e.participants != null ? e.participants.toLocaleString() : "—"}
                  </span>
                </td>
                <td className={td}>
                  <span
                    className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${fundingClasses(
                      e.funding_type
                    )}`}
                  >
                    {FUNDING_LABELS[e.funding_type] || e.funding_type}
                  </span>
                  {e.has_stop_loss && (
                    <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                      stop-loss
                    </span>
                  )}
                </td>
                <td className={td}>
                  <ContactCell row={row} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
