"use client";

import { useCallback, useState } from "react";
import SettingsBar from "@/components/SettingsBar";
import Filters, { FilterValues } from "@/components/Filters";
import ResultsTable, { Row } from "@/components/ResultsTable";
import {
  ApiError,
  Employer,
  enrichContacts,
  getContacts,
  getEmployers,
} from "@/lib/api";
import { Credentials } from "@/lib/credentials";

const PAGE_SIZE = 10;
const ENRICH_CONCURRENCY = 4;

async function pool<T>(items: T[], n: number, worker: (item: T) => Promise<void>) {
  let i = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

export default function Home() {
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [lastFilters, setLastFilters] = useState<FilterValues | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const patchRow = useCallback((ein: string, patch: Partial<Row>) => {
    setRows((prev) =>
      prev.map((r) => (r.employer.ein === ein ? { ...r, ...patch } : r))
    );
  }, []);

  const resolveContacts = useCallback(
    async (employers: Employer[]) => {
      await pool(employers, ENRICH_CONCURRENCY, async (e) => {
        try {
          const cached = await getContacts(e.ein);
          if (cached.length) {
            patchRow(e.ein, { contacts: cached });
            return;
          }
          const enr = await enrichContacts(e.ein);
          patchRow(e.ein, { contacts: enr.contacts, reason: enr.reason });
        } catch (err) {
          patchRow(e.ein, {
            contacts: [],
            error: err instanceof ApiError ? err.message : "lookup failed",
          });
        }
      });
    },
    [patchRow]
  );

  const runSearch = useCallback(
    async (filters: FilterValues, nextOffset: number) => {
      setLoading(true);
      setError(null);
      setSearched(true);
      setLastFilters(filters);
      setOffset(nextOffset);
      try {
        const res = await getEmployers({
          ...filters,
          limit: PAGE_SIZE,
          offset: nextOffset,
          sort: "participants",
          order: "desc",
        });
        setTotal(res.total);
        const fresh: Row[] = res.results.map((employer) => ({ employer, contacts: null }));
        setRows(fresh);
        setLoading(false);
        void resolveContacts(res.results);
      } catch (err) {
        setLoading(false);
        setRows([]);
        setTotal(0);
        setError(err instanceof ApiError ? err.message : "Something went wrong.");
      }
    },
    [resolveContacts]
  );

  const hasCreds = !!creds;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = offset + rows.length;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="sticky top-0 z-20">
        <SettingsBar onChange={setCreds} />
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-24">
        <header className="pt-12 pb-8">
          <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
            DOL Form 5500 · self-insured index
          </div>
          <h1 className="mt-3 font-display text-5xl font-light leading-[1.05] tracking-tight text-ink md:text-6xl">
            Find the employers
            <br />
            <span className="italic text-accent-deep">who fund their own care.</span>
          </h1>
          <p className="mt-4 max-w-xl text-ink-soft">
            Filter ~62,000 self-insured U.S. employers, then surface benefits &amp; HR
            decision-makers — enriched on demand with your Apollo key.
          </p>
        </header>

        <Filters onSearch={(f) => runSearch(f, 0)} disabled={!hasCreds} loading={loading} />

        {error && (
          <div className="mt-5 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 font-mono text-sm text-danger">
            {error}
          </div>
        )}

        {searched && !error && (
          <section className="mt-8">
            <div className="mb-3 flex items-end justify-between">
              <div className="font-mono text-xs text-ink-faint">
                {loading ? (
                  "querying…"
                ) : total > 0 ? (
                  <>
                    <span className="tabular text-ink">{total.toLocaleString()}</span> employers
                    {" · "}showing {showingFrom}–{showingTo}
                  </>
                ) : (
                  "no employers match these filters"
                )}
              </div>
              {total > 0 && (
                <div className="font-mono text-[11px] text-ink-faint">
                  new contacts cost Apollo credits
                </div>
              )}
            </div>

            {rows.length > 0 && <ResultsTable rows={rows} />}

            {total > PAGE_SIZE && (
              <div className="mt-5 flex items-center justify-between font-mono text-sm">
                <button
                  onClick={() => lastFilters && runSearch(lastFilters, Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0 || loading}
                  className="rounded-sm border border-line px-4 py-1.5 text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ← Prev
                </button>
                <span className="text-ink-faint">
                  page {Math.floor(offset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
                </span>
                <button
                  onClick={() => lastFilters && runSearch(lastFilters, offset + PAGE_SIZE)}
                  disabled={showingTo >= total || loading}
                  className="rounded-sm border border-line px-4 py-1.5 text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            )}
          </section>
        )}

        {!searched && (
          <div className="mt-10 rounded-md border border-dashed border-line-strong px-6 py-12 text-center">
            <p className="font-display text-xl text-ink-soft">
              Set your filters and run a search.
            </p>
            <p className="mt-2 font-mono text-xs text-ink-faint">
              Results load instantly; benefits contacts resolve per row.
            </p>
          </div>
        )}
      </main>

      <footer className="mt-16 border-t border-line bg-panel">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <div className="font-display text-xl text-ink">Ant Technology</div>
            <p className="mt-1.5 text-sm text-ink-soft">
              Vertical AI products &amp; software for mission-critical clients.
            </p>
          </div>
          <div className="flex flex-col gap-2 font-mono text-xs md:items-end">
            <span className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">Contact</span>
            <a
              href="https://ant-tek.com"
              target="_blank"
              rel="noreferrer"
              className="text-accent transition-colors hover:text-accent-deep"
            >
              ant-tek.com ↗
            </a>
            <a
              href="mailto:yuanting.luo@ant-tek.com"
              className="text-ink-soft transition-colors hover:text-accent"
            >
              yuanting.luo@ant-tek.com
            </a>
          </div>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-x-4 gap-y-1 px-6 py-4 font-mono text-[10px] text-ink-faint">
            <span>© {new Date().getFullYear()} Ant Technology. All rights reserved.</span>
            <span>Public DOL Form 5500 data · contacts via your own Apollo key</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
