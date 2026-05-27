---
name: update
description: Pull the latest code from the private biolab-leads repo's `release` branch into this working directory. Idempotent — does nothing if already up to date. Preserves the user's `raw/`, `data_parquet/`, `query-result/`, and `.claude/settings.local.json`. Triggered by `/update`.
---

# update — pull the latest code without git

You (Claude) are walking a non-technical user through a code update.
They opened Claude Code in this repo and typed `/update`. Your job
is to run the updater script and surface its output — the client
never sees git directly.

The updater is **idempotent**: if there's nothing new it exits with
"Already on the latest release …" and the user is done.

## Run the updater

Tell the user *"Checking for updates…"* before running:

```bash
bash src/scripts/update.sh
```

Stream stdout. The script prints, in order:

1. `Fetching latest from release…`
2. Either `Already on the latest release (<sha>).` and exits, OR
3. `Pending commits:` followed by a `git log --oneline` block, then
4. `Applying update…` (the hard reset to `origin/release`)
5. Either `package.json changed - installing dependencies…` followed
   by npm output, OR `package.json unchanged - skipping npm install.`
6. `Updated to <sha>. N commit(s) applied.`

When the script exits 0, you're done. Repeat its final summary line
to the user verbatim.

## Why this is safe

- `git reset --hard` only touches tracked files. The client's
  `raw/`, `data_parquet/`, `query-result/`, `src/node_modules/`,
  and `.claude/settings.local.json` are gitignored and untouched.
- The script aborts early if `.git/` is missing, so it never
  half-applies an update.
- If the package hash didn't change, `npm install` is skipped —
  re-running `/update` is cheap.

## Failure handling

- **`.git/` missing**: tell the user to unzip a fresh copy of the
  biolab-leads folder and try again. Do not attempt recovery.
- **`git fetch` fails (network or auth)**: surface the error verbatim
  and stop. Suggest checking internet/credentials and retrying. The
  working tree is unchanged.
- **`git reset --hard` fails (e.g. disk full)**: surface the error.
  Re-running `/update` retries cleanly.
- **`npm install` fails**: code is already updated; only the dependency
  refresh failed. Surface the error and tell the user to manually run
  `rm -rf src/node_modules`, then re-run `/update`.

Don't silently retry. If the script exits non-zero, stop and let the
user choose.

## After updating

If `build_parquet.js` or the schema changed, the parquet may need a
rebuild. If the final summary mentions data/build changes, suggest the
user run `/setup` (it will rebuild only if needed).
