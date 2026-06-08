# biolab-leads — web UI

Search self-insured employers (DOL Form 5500) and surface benefits/HR contacts. A client-side
Next.js app that talks to the biolab-leads HTTP API. Branded to match ant-tek.com.

## Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

Enter an **allowlisted** email + your **Apollo key** in the Access bar, then search. The API base
URL comes from `NEXT_PUBLIC_API_BASE` (see `.env.local.example`) and defaults to the deployed API.

## Build (static export)

The app is fully client-side and builds to a static site (`output: "export"`):

```bash
npm run build        # emits ./out (static HTML/CSS/JS, self-hosted fonts)
```

## Deploy on Netlify

This repo has a root `netlify.toml` configured for this app, so the site settings auto-fill.

1. **Netlify → Add new site → Import from Git** → authorize GitHub, pick `yuluo/biolab-leads`.
2. Settings auto-fill from `netlify.toml`: base `web`, build `npm run build`, publish `web/out`,
   Node 20. Confirm and deploy → you get a `https://<name>.netlify.app` URL.
3. **(Optional)** Override the API by setting `NEXT_PUBLIC_API_BASE` under
   Site settings → Environment variables (the deployed API is the default in code).
4. **(Optional)** Add a custom domain (e.g. `leads.ant-tek.com`) under Domain management, then
   create the **CNAME** record Netlify shows at your DNS provider. Netlify provisions TLS.

The page is public, but data stays gated by the API's authorized-email allowlist + Apollo key.
Pushes to `main` auto-deploy once the repo is connected.
