---
name: setup
description: One-command setup for this biolab-leads repo. Installs Node.js (if missing), installs npm dependencies, and builds the Form 5500 CSVs under `raw/` into `data_parquet/employers.parquet` so `/search` works immediately afterward. Triggered by `/setup`.
---

# setup — get this repo ready to query

You (Claude) are walking a non-technical user through setup. They opened
Claude Code in this repo and typed `/setup`. Your job is to make
everything ready for `/search` with **zero questions** — install the
toolchain and build the employer dataset from the DOL CSVs under `raw/`.

The setup has three phases. **Each phase is idempotent** — check first,
skip if already done, only run work that's needed. Tell the user what
you're about to do *before* a long-running step.

## Phase 1 — Node.js

Run the installer; it self-detects whether Node is missing or too old.

```bash
bash src/scripts/install_node.sh
```

- Exit 0 = Node ≥20 is on PATH. Continue.
- Non-zero = installer printed an error. Surface it and stop.

On macOS the script may install Homebrew first (sudo prompt). On Linux
it installs `nvm` to `~/.nvm`. On Windows it prints manual instructions —
if `uname` reports MINGW/CYGWIN/MSYS, tell the user to install Node 20+
from https://nodejs.org/ and re-run `/setup`.

## Phase 2 — npm dependencies

Check whether deps are already installed, and only install if missing.
Run each command as a *discrete* Bash call.

```bash
test -d src/node_modules
```

- Exit 0 = deps present. Tell the user *"Dependencies present, skipping
  npm install."* and continue.
- Non-zero = need to install. Tell the user *"Installing dependencies…"*
  then run:

```bash
npm --prefix src install
```

## Phase 3 — Build the employer parquet

The build reads the DOL Form 5500 + Schedule A CSVs under `raw/`, joins
and classifies them, and writes one row per employer to
`data_parquet/employers.parquet`.

First verify the raw CSVs are present:

```bash
ls raw/F_5500_*/f_5500_*_latest.csv 2>/dev/null | wc -l
```

- If the count is 0, stop and tell the user:

  > *No Form 5500 data found under `raw/`. Download these from the DOL
  > Form 5500 datasets page (https://www.dol.gov/agencies/ebsa/about-ebsa/our-activities/public-disclosure/foia/form-5500-datasets),
  > unzip each into its own folder under `raw/`, then re-run `/setup`:*
  > - `F_5500_2024_Latest.zip` and `F_5500_2025_Latest.zip` (Form 5500)
  > - `F_SCH_A_2024_Latest.zip` and `F_SCH_A_2025_Latest.zip` (Schedule A)
  >
  > *(Direct files live under `https://askebsa.dol.gov/FOIA Files/<year>/Latest/`.)*

Then check whether the parquet already exists:

```bash
test -f data_parquet/employers.parquet
```

- Exit 0 = already built. Tell the user *"Employer dataset already built,
  skipping."* and skip the build.
- Non-zero = run the build:

```bash
npm --prefix src run build-parquet
```

`build_parquet.js` refuses to overwrite a non-empty output file, so the
guard above is also a safety net. It prints a `[progress]` line every
30 seconds — stream stdout so the user sees the heartbeat. The build is
fast (a few seconds on the 2024+2025 data).

## Final report

When all three phases are clean, print a one-paragraph summary:

- Node version (`node -v`)
- Source CSV count (`ls raw/F_5500_*/f_5500_*_latest.csv | wc -l`)
- Employer + funding breakdown — run:

```bash
npm --prefix src run query -- --table "SELECT funding_type, COUNT(*) AS employers FROM employers GROUP BY 1 ORDER BY 2 DESC"
```

- A literal next-step hint: *"Try `/search self-insured employers in CA
  with 500+ employees` to query the dataset."*

## Phase 4 (optional) — Apollo enrichment key

`/search` automatically enriches result EINs with HR/benefits contacts
(name, title, business email, LinkedIn) via Apollo.io, and persists them
locally so future searches over the same companies cost nothing. This is
**BYO-key** — we never redistribute licensed contact data.

Check whether a key is configured:

```bash
test -s .env && grep -q '^APOLLO_API_KEY=.\+' .env
```

- Exit 0 = key present. Tell the user enrichment is wired up.
- Non-zero = no key. Tell the user (verbatim):

  > *Enrichment is optional. To turn it on later, get an Apollo.io API
  > key (apollo.io → Settings → Integrations → API) and paste it after
  > `APOLLO_API_KEY=` in `.env`. Until then, `/search` works fine —
  > you'll just get company-level rows without contacts.*

Do not block setup on this; enrichment is an opt-in layer.

## Failure handling

- **`bash` not available** (plain Windows cmd): tell the user to open Git
  Bash or WSL and re-run `/setup`.
- **No internet** during Node install: surface the curl/brew error and
  suggest connecting and retrying.
- **Disk full** during the build: remove the partial output
  (`rm -f data_parquet/employers.parquet`) and ask the user to free space.
- **No CSVs in `raw/`**: stop and give the download instructions above.

Don't silently retry. If a phase fails, stop and let the user choose.
