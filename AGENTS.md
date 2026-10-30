# AGENTS.md

PrdManager is an Electron desktop app for managing product requirement documents.
Privileged work lives in the main process; the renderer reaches it through oRPC
over a `MessagePort`. `CLAUDE.md` has the deeper architecture notes.

## Stack

Node 26.13.0 (`.nvmrc`), npm · Electron 45 + Forge + Vite · React 19 (React
Compiler) · TypeScript strict · Tailwind v4 + shadcn/ui · TanStack Router
(memory history) · oRPC + zod 4 · better-sqlite3 + Drizzle · electron-store ·
i18next · Vitest + Playwright.

## Commands

| Task | Command |
| --- | --- |
| Dev app (HMR) | `npm start` |
| Typecheck | `npm run typecheck` |
| Lint/format check · autofix | `npm run check` · `npm run fix` |
| Unit tests, once | `npm test` |
| Unit tests, watch | `npm run test:unit` (watch mode; use `npm test` in CI) |
| Coverage | `npm run test:coverage` |
| One file · one test | `npx vitest run src/tests/unit/db.test.ts` · `npx vitest run -t "name"` |
| E2E (packaged app) | `npm run test:e2e:build` then `npm run test:e2e` |
| Everything | `npm run test:all` |
| Schema change | edit `src/db/schema.ts`, run `npm run db:generate`, commit `drizzle/` |
| Package · installers · publish | `npm run package` · `npm run make` · `npm run publish` |
| Re-add shadcn components | `npm run bump-ui` |

## Where things live

All paths below are under `src/`.

```
main.ts       main process: single-instance lock, session hardening, DB init,
              oRPC MessagePort upgrade, window creation
preload.ts    sandboxed, dependency-free MessagePort forwarder
renderer.ts   renderer entry -> app.tsx (theme/language sync, RouterProvider)
ipc/          oRPC router: <namespace>/{schemas,handlers,index}.ts + client manager
ipc/dialog    native file/folder pickers (showOpenDialog) with strict schemas
actions/      typed renderer wrappers around ipc.client.<namespace>.<procedure>()
db/           better-sqlite3 + Drizzle cache: schema.ts, startup/migration logic
preferences/  main-only electron-store: schema, validated store, window bounds
routes/       file-based TanStack Router routes; routeTree.gen.ts is generated
tests/unit    Vitest; tests/e2e Playwright against the packaged binary
```

Transport flow: `main.ts` upgrades a port posted by `preload.ts`, which forwards
the port created in `ipc/manager.ts`. `ipc.client` is the renderer's only access
to Node — components import `src/actions/*`, never `ipc` or `electron`.

## How to change things

**IPC procedure.** (1) Zod input/output schemas in `ipc/<namespace>/schemas.ts`
(most object inputs `.strict()`; resolve + NUL-check paths, bound any JSON).
(2) `os.input(...).output(...).handler(...)` in `handlers.ts` — lookups return
`null`, mutations throw `ORPCError` (`NOT_FOUND`, ...). (3) Add it to the exported
namespace in `index.ts`; that object feeds the `RouterClient` type. (4) Add the
namespace to `ipc/router.ts` only when it is new. (5) Add a wrapper in
`src/actions/`. Window procedures use `ipcContext.mainWindowContext`. Never log
customer data; `ipc/handler.ts` logs 4xx as debug and 5xx as errors by design.

**Wire data is JSON.** Timestamps are epoch milliseconds, never `Date`; no
`Map`/`Set`/`BigInt`. `metadataJson` is bounded (depth 8, 1000 nodes, 64 KiB).

**Database.** The file is a disposable cache and its safety rules are
load-bearing: `application_id` sentinel `0x43414348` proves ownership; a
non-SQLite header, symlink, hard link, or foreign database is refused without
modification; corruption is reset in place or moved aside as
`cache.db.corrupt-<timestamp>`, never deleted; permissions are `0600` (`0700` on
the default `userData` parent only). `APP_CACHE_DB_PATH` must be absolute (or
`:memory:`); `APP_CACHE_SKIP_INTEGRITY_CHECK=1` skips the dev-only check.
`customers` is keyed by `folderPath`; `searchText` is a pre-folded (NFC +
lowercase) concatenation maintained by `upsertCustomer` so `instr()` works
without per-row JS. Upsert is a patch: omitted keeps, explicit `null` clears,
`createdAt` never changes. After schema edits, regenerate and commit `drizzle/`
(snapshots included) — CI fails on drift.

**Preferences.** Theme, language and window state live in a main-process
electron-store file (`preferences.json`). The renderer reaches language through
the `preferences` namespace; theme still uses the `theme` namespace, whose
handlers persist to the same store. electron-store is ESM-only and is bundled
into the CJS main bundle — keep it in `dependencies` but do not externalise it,
and never import it in the renderer. The store refuses symlinks, non-regular
files and files over 64 KiB, writes `0600`, and honours `APP_PREFERENCES_DIR`
(absolute) only in development/E2E builds.

**Dialogs.** `dialog.openFile` and `dialog.openDirectory` wrap
`dialog.showOpenDialog` in the main process, parented to the main window.
`openFile` accepts `title`, `defaultPath`, `buttonLabel`, `filters`, `multiple`
and `showHiddenFiles`; `openDirectory` accepts the same without `filters`.
Inputs are strict and bounded; `defaultPath` must be absolute and non-UNC, and
extensions are normalised (`.png`/`*.png` → `png`). The renderer calls
`actions/dialog.ts`. Native dialogs are not covered by e2e tests.

**Renderer.** React Compiler is on, so write plain components without reflexive
`useMemo`/`useCallback`. UI strings via `t()`: add keys to both `en` and `pt-BR`
in `localization/i18n.ts` (and the language to `langs.ts`). Theme is three-state
and owned by `nativeTheme` in main; the renderer mirrors `.dark` and follows
`matchMedia` in `system` mode — go through `actions/theme.ts`. Use `cn()` from
the `cn` package (re-exported by `utils/cn.ts`) for conditional classes.

## Gotchas

1. The renderer has no Node access. Never import `electron` or `ipc` in a
   component; use `src/actions/*`.
2. `ipc/window/hadlers.ts` and `app.currentPlatfom` are misspelled public API.
   Renaming either changes the router shape.
3. `routeTree.gen.ts` is generated by the TanStack Router plugin — never edit it;
   add files under `routes/`. Routing uses memory history, so there is no URL.
4. Main startup order is deliberate: `hardenSession()` -> `initializePreferences()`
   + stored theme -> `initDatabase()` -> register the oRPC listener ->
   `createWindow()`. The renderer posts its port while evaluating its bundle, so
   the listener must already exist. A saved maximized state is restored in
   `ready-to-show`, not before, because `maximize()` shows the window.
5. Use `!app.isPackaged` in main, never `NODE_ENV` (Forge does not set it). The
   renderer's `inDevelopment` constant uses build-time `NODE_ENV`; the two are
   not interchangeable.
6. `npm run test:unit` watches. Unit tests default to jsdom; database tests use
   `// @vitest-environment node`. Mock `electron` with `vi.hoisted` + `vi.mock`.
7. E2E launches the packaged executable, never stock Electron:
   `test:e2e:build` runs `APP_E2E=1 electron-forge package` because the
   production fuse disables `--inspect`. Tests run `workers: 1` and the helper
   forwards only an environment allowlist. It also sets `APP_USER_DATA_DIR`:
   on macOS `HOME` does not isolate `userData`, so without it the single-instance
   lock collides with a running dev app.
8. `components/ui/**` is shadcn output (excluded from lint/coverage).
   `npm run bump-ui` re-adds those components and overwrites local edits.
9. The `@` -> `src` alias is duplicated in `tsconfig.json`, all three Vite
   configs, and `vitest.config.ts`; change them together.
10. `window.open`, navigation, redirects, subframes, permissions, and downloads
    are blocked. External links go through `actions/shell.ts` (`http:`/`https:`
    only); CSP lives in `index.html`.
11. `better-sqlite3` is externalised and copied by Forge's `packageAfterCopy`
    hook. Another native module needs the same packaging work.
12. Coverage thresholds differ by area (`db/**` 80–90%, `ipc/**` 85%+); new
    untested code can fail CI even when tests pass.
13. electron-store is ESM-only and main-process-only. It is bundled into the CJS
    main; do not externalise it or import it from the renderer.
    `APP_PREFERENCES_DIR` must be absolute.

## Boundaries

- Do not weaken Electron security settings, fuses, CSP, navigation, or permission
  handlers.
- Do not delete/reset a database outside the existing recovery path or relax the
  ownership/symlink/hard-link checks.
- Do not hand-edit generated files (`routeTree.gen.ts`, `components/ui/**`,
  `drizzle/`, `graphify-out/`).
- Do not bypass oRPC or the `actions/*` wrappers from the renderer.
- Do not commit secrets; `.env*` and local Claude settings are ignored.
- Repo rules: context7 MCP for library/API questions, `graphify` for
  codebase/architecture questions.
