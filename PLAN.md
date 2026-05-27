# biolab-leads — Self-Insured Employer Targeting Tool

A free, local, Claude-Code-driven tool that turns the public DOL Form 5500 dataset into
a scored list of **self-insured employers** a DTC biolab could sell into (employer covers
the test for its workforce). Used as a **marketing/lead-gen asset**, not a SaaS product:
post on LinkedIn → free sample list → assisted local setup → convert to consulting client.

**What we're actually selling is *me as the fractional IT/data person* for biolabs too
small to hire one full-time.** The tool is the magnet and the most legible proof of what
that person does; the leads list is bait, the catch is the ongoing IT/data relationship.
Small biolabs can't self-serve this — that inability *is* the demand. Don't expect the
leads tool itself to be the thing they pay for; expect it to start the conversation that
turns into setup + integration + adjacent IT/data work.

## Strategic context (shapes the build)

- **Not SaaS.** No hosting, no accounts. Ships as a local tool the user runs on their own
  machine, exactly like the `~/workspace/biodata` model (DuckDB query layer + Claude Code
  skills for `setup` / `search` / `update`).
- **Local-only is a feature, not just convenience.** Contact enrichment produces PII
  (names/emails). Keeping everything on the client's machine means we never host personal
  data → sidesteps CCPA/GDPR and data-vendor redistribution liability.
- **Door-opener, not the product.** The data-list business is already commoditized
  (Judy Diamond Associates, Larkspur, BrightScope build prospecting DBs off 5500s).
  Our edge is a turnkey, *test-fit-scored* list handed over by someone who'll also wire it
  into the client's HubSpot. Service wrapped around commodity public data.
- **Free is deliberate.** You can't gate cheap public data without adding friction, and the
  target — small biolabs — can't afford an in-house IT person anyway. Give the data away
  freely; the scarce resource we protect is *our setup time*, not the data (see funnel).
- **IP:** the engine/scripts are reusable background IP, built off any client's clock.
  Each client owns only their config, their enrichment output, and their integration.

## Distribution model (mirror biodata)

- Ship as zip / gated git clone with an `update.sh` (reuse biodata's PAT-gated mechanism).
- **Gate our setup time, not the data.** The data/tool is free; the scarce resource is the
  hands-on assisted setup. The request list *is* the lead list, but the qualifying gate is a
  short intake before we hand-set-up (see funnel Stage 2).
- Driven through Claude Code skills so non-technical biolab BD/marketing staff can operate it.

## Two-stage funnel (the build must serve both)

1. **Stage 1 — zero-friction magnet:** *we* run the tool and send a prospect a sample scored
   CSV for their company. Requires the tool to produce a clean CSV from a one-line config
   (their test category / target employer profile). This is what the LinkedIn post offers.
2. **Stage 2 — assisted local setup (the qualifying gate):** before spending hands-on setup
   time, a ~10-min intake call that both qualifies and starts the sales conversation:
   - Do they have a **test that fits the employer/benefits channel**? (hard filter)
   - Budget / intent for follow-on IT/data work?
   Spend free setup time only on labs that can become clients — not everyone who DMs.
   Then: install locally, plug in their own enrichment key, run `/search`. This is the
   consulting on-ramp, and the real product (fractional IT/data) is the follow-on.

## What needs to be built

### 1. Data ingestion — DOL Form 5500 (public, safe to ship)
- [ ] Pull the yearly Form 5500 + Schedule data from DOL EFAST2 bulk download.
- [ ] Identify the **self-funded / funding-arrangement** flag(s) and **participant counts**.
- [ ] Normalize to a tidy table: employer name, EIN, plan type, funding type,
      participant count, plan year, industry (NAICS/SIC if present), location.
- [ ] Build into DuckDB/parquet (reuse biodata's `build_parquet.js` pattern).
- [ ] Decide refresh cadence: DOL publishes ~yearly → `update.sh` re-pulls; cheap, infrequent.

### 2. Filtering + scoring layer
- [ ] Filter to **self-insured** plans above a size threshold (configurable participant min).
- [ ] Scoring inputs to rank test-fit: plan/participant size, industry, geography, and any
      proxy for benefits spend / workforce demographics relevant to the specific test.
- [ ] Scoring config is **per-client/per-test** (the tunable, billable part) — keep it in a
      single editable config file, not hardcoded.

### 3. Contact enrichment — BRING-YOUR-OWN KEY (do not ship/redistribute)
- [ ] Script to enrich employers with decision-maker contacts (benefits/HR leads) via a
      pluggable provider (Apollo / Clay / People Data Labs).
- [ ] **Client supplies their own API key** — we never redistribute licensed contact data,
      and the contact layer (which decays ~30%/yr) becomes a natural recurring service.
- [ ] Keep 5500 layer and contact layer cleanly separated (ship the first, BYO the second).

### 4. Claude Code skills (clone biodata's `.claude/skills`)
- [ ] `setup` — install Node/deps, build the parquet, prompt for enrichment API key.
- [ ] `search` — natural-language → DuckDB query over scored employers; export CSV.
      Needs a `schema.md` + `examples.md` like biodata's search skill.
- [ ] `update` — re-pull latest DOL 5500 release, rebuild.

### 5. Output / handoff
- [ ] Clean CSV export (the Stage-1 sample artifact).
- [ ] HubSpot import format / mapping notes (clients use HubSpot for lead tracking).

### 6. Marketing assets (not code, but part of "what needs to be built")
- [ ] LinkedIn post: angle is **"labs your size can't justify a full-time data/IT hire —
      here's a taste of having one."** Lead with the prospect's outcome + a concrete sample
      result, CTA to DM. The post sells *me as fractional IT/data*, not a lead list.
      Target DTC biolabs in **non-competing** test categories; avoid OneTest competitors.
- [ ] One-line intake (test category / target employer profile) to generate a Stage-1 sample.
- [ ] Short Stage-2 intake script (qualify: employer-channel-fit test? follow-on budget?).

## Ideal customer profile (target by GTM motion, not size)
- **Fit:** DTC diagnostics labs with a sellable test pursuing the **employer/benefits
  channel**, too small to afford in-house IT/data. Sweet spot = has a product + some BD,
  lacks the targeting engine and the technical hands to run it (i.e. needs *me*).
- **Not a fit (hard filter):** research / sequencing labs (e.g. AMPSEQ, HGID type) — no
  employer channel to target into, regardless of size. Also: too-early labs with no
  validated test to sell.
- **Note:** current contacts skew non-fit (sequencing/research), so this play depends on
  reaching *new* prospects of the right type, not monetizing existing relationships.

## Open questions / decisions pending
- [ ] Project name (placeholder: `biolab-leads`).
- [ ] Which enrichment provider to document first (Apollo cheapest; Clay most flexible).
- [ ] Exact DOL 5500 fields for the self-funded flag — confirm against a real file before scoping.
- [ ] Whether to validate the LinkedIn post pulls DMs *before* polishing the local tool
      (the local self-install is the deep end of the funnel — most converts come from the
      free sample, so don't over-build ahead of demand).

## Reference
- Model to clone: `~/workspace/biodata` (DuckDB + `.claude/skills` setup/search/update, `update.sh`).
- Commodity comparables: Judy Diamond Associates, Larkspur, BrightScope, FreeERISA.
- Raw source: DOL EFAST2 Form 5500 bulk data.
