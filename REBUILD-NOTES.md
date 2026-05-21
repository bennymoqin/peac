# PEAC Source Rebuild Notes

Date: 2026-05-21

## Status

This directory is a recovered source workspace created from:

- `C:\Users\benny\Desktop\04_源代码_source_code.md`
- Current v1.2.0-beta.2 distribution package public enhancement assets

The recovered source dump was generated on 2026-05-07, while the current package is v1.2.0-beta.2 from 2026-05-17. Treat this as an early source baseline, not as a complete match for the current package.

## Recovered Baseline

- `app/page.tsx`
- `app/layout.tsx`
- `app/globals.css`
- `app/api/export/route.ts`
- `app/api/models/chat/route.ts`
- `app/api/models/group/route.ts`
- `app/api/upload/route.ts`
- `lib/llm.ts`
- `lib/office-export.ts`
- `lib/prompt-presets.ts`
- project config files
- source export/package scripts

## Current Package Assets Added

- `public/peac-ui-workbench.js`
- `public/peac-ui-workbench.css`
- `public/peac-pptx-export.js`
- `tools/pptx-from-images.js`

## Source Rebuild Work Started

- Recreated `app/api/images/generate/route.ts` from the current v1.2.0-beta.2 package behavior.
- Wired `app/layout.tsx` to load the workbench CSS, workbench enhancer, and finished-image PPTX exporter.
- Updated `app/api/upload/route.ts` to use local PDF geometry fallbacks instead of the missing `@napi-rs/canvas/geometry` dependency.
- Updated `lib/llm.ts` with DMXAPI text relay compatibility: direct `Authorization: sk-...`, supported `reasoning_effort`, and tolerant group-output JSON parsing.
- Updated `package.json` to mark this workspace as `1.2.0-beta.2-recovered` and added `check` / `pptx:images` scripts.
- Added the current launcher scripts: `launcher.js`, `start-windows.bat`, `Start_PEAC.bat`, and `start-macos.command`.

## Still Missing From Source

- native React implementation of the v1.1/v1.2 workbench layout
- native React implementation of the model comparison page
- native React implementation of DMXAPI text/image relay settings
- source-level integration for finished-image PPTX export
- package scripts and launcher files for the current v1.2.0-beta.2 distribution workflow

## Verification Notes

- The current distribution package still passes `npm run check`.
- The recovered source workspace passes its current `npm run check` for JS enhancement assets.
- This recovered source directory does not yet have a full development dependency install. TypeScript and ESLint checks could not run from this directory with the packaged production dependencies alone.

## Recommended Next Steps

1. Add or install development dependencies for this source workspace.
2. Run `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
3. Move the workbench, DMXAPI, model comparison, and PPTX image export features from enhancement scripts into source components and API modules.
4. Build a fresh standalone package from source and compare it against the current v1.2.0-beta.2 package.
