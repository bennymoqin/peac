# PEAC Codex Development Guide

Date: 2026-05-21
Version: v1.2.0-beta.3 development handoff

This folder is the development workspace to open in Codex on another Windows computer.

## What to open

Open the extracted project folder itself in Codex. The folder should contain:

- `app/`
- `lib/`
- `public/`
- `tools/`
- `package.json`
- `CODEX-DEVELOPMENT-GUIDE.md`

## First setup on the new Windows computer

1. Install Node.js 20 or newer if the computer does not already have it.
2. Open this folder in Codex.
3. Ask Codex to run:

```powershell
npm install
npm run check
npm run dev
```

Then open the local address printed by Next.js, usually `http://localhost:3000`.

## Useful commands

```powershell
npm run dev
npm run build
npm run check
npm run pptx:images
```

## Current development notes

- This package intentionally does not include `node_modules`, `.next`, or previous `dist` output.
- The current runnable release assets are in `public/peac-ui-workbench.js`, `public/peac-ui-workbench.css`, and `public/peac-pptx-export.js`.
- `REBUILD-NOTES.md` records which parts were recovered as source and which features still need to be moved from enhancement scripts into native source modules.
- Root-level product and teacher-facing documentation has been included under `docs/`.

## API keys and secrets

Do not put real API keys directly into source files. Use local environment files on the development computer, and keep `.env` files out of shared packages.
