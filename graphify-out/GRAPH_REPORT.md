# Graph Report - sauger  (2026-10-29)

## Corpus Check
- 44 files · ~15,903 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 614 nodes · 1013 edges · 37 communities (23 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Drizzle ORM & Customer Schema
- React UI Libraries
- SQLite Native & E2E Tests
- Cache Database Lifecycle
- Electron Main & oRPC Server
- CI Unit & E2E Workflow
- IPC Client & Customer Actions
- Runtime Dependencies
- Electron Forge Packaging
- Package Metadata & Tooling
- TypeScript Configuration
- Dev Dependencies & Build
- shadcn Component Config
- Theme & Language Actions
- CI Publish Workflow
- TanStack Route Tree
- CI Check Workflow
- PrdManager Architecture & Docs
- npm Scripts
- Code Quality Guidelines
- Vite Build Plugins
- Demo Screenshot & Landing UI
- Dependabot Updates
- UI Component Bump Script
- jest-dom Test Setup
- Electron Forge CLI
- GitHub Publisher Plugin
- jsdom Test Environment
- Tailwind CSS
- React Testing Library
- Babel Type Packages
- better-sqlite3 Type Definitions
- React Type Definitions
- Ultracite Linter
- Vitest Coverage Provider

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 20 edges
2. `cn()` - 19 edges
3. `scripts` - 15 edges
4. `@orpc/server` - 12 edges
5. `react` - 12 edges
6. `Ultracite Code Standards` - 11 edges
7. `vitest` - 11 edges
8. `electron` - 9 edges
9. `@tanstack/react-router` - 8 edges
10. `better-sqlite3` - 8 edges

## Surprising Connections (you probably didn't know these)
- `NavigationMenuContent()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/navigation-menu.tsx → src/utils/tailwind.ts
- `NavigationMenuIndicator()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/navigation-menu.tsx → src/utils/tailwind.ts
- `SecondPage()` --calls--> `NavigationMenu()`  [EXTRACTED]
  src/routes/second.tsx → src/components/navigation-menu.tsx
- `HomePage()` --calls--> `NavigationMenu()`  [EXTRACTED]
  src/routes/index.tsx → src/components/navigation-menu.tsx
- `launchFresh()` --calls--> `launchPackagedApp()`  [EXTRACTED]
  src/tests/e2e/cache-db.test.ts → src/tests/e2e/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **electron-shadcn Landing Page Composition** — images_demo_app_window, images_demo_logo_cluster, images_demo_electron_shadcn_brand, images_demo_version_label, images_demo_author_credit [EXTRACTED 0.95]
- **Ultracite Code Standards Principle Set** — _github_copilot_instructions_ultracite, _github_copilot_instructions_type_safety, _github_copilot_instructions_modern_js_ts, _github_copilot_instructions_async_promises, _github_copilot_instructions_react_jsx, _github_copilot_instructions_error_handling, _github_copilot_instructions_code_organization, _github_copilot_instructions_security, _github_copilot_instructions_performance, _github_copilot_instructions_testing [EXTRACTED 1.00]
- **In-App Preference Controls (Locale and Theme)** — images_demo_language_switcher, images_demo_dark_mode_toggle, images_demo_app_window [INFERRED 0.85]
- **SQLite Cache Integrity and Recovery Flow** — readme_sqlite_cache, readme_drizzle_orm, readme_cache_corruption_recovery, readme_application_id_sentinel [EXTRACTED 1.00]
- **Renderer Hardening Boundary** — readme_electron_sandbox, readme_orpc_ipc_boundary, index_content_security_policy, index_html [INFERRED 0.85]

## Communities (37 total, 14 thin omitted)

### Community 0 - "Drizzle ORM & Customer Schema"
Cohesion: 0.06
Nodes (45): drizzle-orm@^0.45.4, vitest@^5.0.5, drizzle-orm, vitest, zod, CUSTOMER_STATUSES, CustomerStatus, getDatabase() (+37 more)

### Community 1 - "React UI Libraries"
Cohesion: 0.07
Nodes (43): @icons-pack/react-simple-icons@^13.15.1, lucide-react@^1.63.0, react-i18next@^17.1.9, @tanstack/react-router@^1.170.46, class-variance-authority, @icons-pack/react-simple-icons, lucide-react, radix-ui (+35 more)

### Community 2 - "SQLite Native & E2E Tests"
Cohesion: 0.07
Nodes (22): better-sqlite3@^13.0.3, better-sqlite3, @playwright/test, launchFresh(), createTempCacheDir(), getProcessEnv(), launchPackagedApp(), removeTempDir() (+14 more)

### Community 3 - "Cache Database Lifecycle"
Cohesion: 0.09
Nodes (32): ENVIRONMENT_VARIABLES, inDevelopment, IPC_CHANNELS, ancestorDirectories(), assertCacheOwnership(), assertIntegrity(), assertIsSqliteFile(), CacheDatabase (+24 more)

### Community 4 - "Electron Main & oRPC Server"
Cohesion: 0.08
Nodes (24): @orpc/server@^1.16.1, electron@^45.1.0, electron, @orpc/server, appVersion, currentPlatfom, app, IPCContext (+16 more)

### Community 5 - "CI Unit & E2E Workflow"
Cohesion: 0.08
Nodes (29): GITHUB_TOKEN, SAUGER_E2E, jobs, test-e2e, tests-unit, name, on, pull_request (+21 more)

### Community 6 - "IPC Client & Customer Actions"
Cohesion: 0.10
Nodes (14): @orpc/client@^1.16.1, @orpc/client, getPlatform(), closeWindow(), maximizeWindow(), minimizeWindow(), DragWindowRegion(), DragWindowRegionProps (+6 more)

### Community 7 - "Runtime Dependencies"
Cohesion: 0.08
Nodes (25): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, electron-squirrel-startup@^1.0.1, @fontsource-variable/geist@^5.3.0, @fontsource-variable/geist-mono@^5.3.0, radix-ui@^1.8.1, react@^19.3.1 (+17 more)

### Community 8 - "Electron Forge Packaging"
Cohesion: 0.09
Nodes (20): betterSqlite3Source, config, @electron-forge/maker-deb@^8.0.1, @electron-forge/maker-rpm@^8.0.1, @electron-forge/maker-squirrel@^8.0.1, @electron-forge/maker-zip@^8.0.1, @electron-forge/plugin-auto-unpack-natives@^8.0.1, @electron-forge/plugin-fuses@^8.0.1 (+12 more)

### Community 9 - "Package Metadata & Tooling"
Cohesion: 0.09
Nodes (21): author, description, electron-devtools-installer@^4.0.0, electron-playwright-helpers@^3.1.2, @types/electron-squirrel-startup@^1.0.2, typescript@^7.0.2, @electron/fuses, engines (+13 more)

### Community 10 - "TypeScript Configuration"
Cohesion: 0.09
Nodes (21): compilerOptions, allowJs, allowSyntheticDefaultImports, composite, declaration, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+13 more)

### Community 11 - "Dev Dependencies & Build"
Cohesion: 0.10
Nodes (20): devDependencies, @babel/core@^8.0.9, babel-plugin-react-compiler@^1.0.0, @biomejs/biome@^2.6.3, drizzle-kit@^0.31.11, @playwright/test@^1.64.1, @testing-library/user-event@^14.6.8, tsx@^4.23.15 (+12 more)

### Community 12 - "shadcn Component Config"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+11 more)

### Community 13 - "Theme & Language Actions"
Cohesion: 0.16
Nodes (14): i18next@^26.5.11, i18next, updateAppLanguage(), getCurrentTheme(), setTheme(), syncWithLocalTheme(), ThemePreferences, toggleTheme() (+6 more)

### Community 14 - "CI Publish Workflow"
Cohesion: 0.11
Nodes (17): GITHUB_TOKEN, jobs, publish-release, name, on, workflow_dispatch, permissions, contents (+9 more)

### Community 15 - "TanStack Route Tree"
Cohesion: 0.14
Nodes (16): Route, Route, Route, FileRoutesByFullPath, FileRoutesById, FileRoutesByPath, FileRoutesByTo, FileRouteTypes (+8 more)

### Community 16 - "CI Check Workflow"
Cohesion: 0.12
Nodes (16): runs-on, steps, jobs, check, name, on, pull_request, permissions (+8 more)

### Community 17 - "PrdManager Architecture & Docs"
Cohesion: 0.17
Nodes (7): src/styles/global.css, index.html Renderer Document, src/renderer.ts Entry Module, GitHub Releases Auto Update, Drizzle ORM with better-sqlite3, GitHub Actions CI/CD and Releases, PrdManager

### Community 18 - "npm Scripts"
Cohesion: 0.13
Nodes (15): scripts, bump-ui, check, db:generate, fix, make, package, publish (+7 more)

### Community 20 - "Vite Build Plugins"
Cohesion: 0.14
Nodes (10): @tailwindcss/vite@^4.3.3, @rolldown/plugin-babel@^0.2.4, @tanstack/router-plugin@^1.168.48, vite@^8.3.5, @vitejs/plugin-react@^6.1.2, @rolldown/plugin-babel, @tailwindcss/vite, @tanstack/router-plugin (+2 more)

### Community 21 - "Demo Screenshot & Landing UI"
Cohesion: 0.23
Nodes (12): electron-shadcn Application Window, Made by LuanRoger Attribution, Dark Mode Toggle Button, Documentation Nav Link, electron-shadcn Brand Title, Home Page Nav Link, EN-US / PT-BR Language Switcher, Electron, Vite and React Logo Cluster (+4 more)

### Community 22 - "Dependabot Updates"
Cohesion: 0.29
Nodes (6): interval, updates, directory, package-ecosystem, schedule, version

### Community 23 - "UI Component Bump Script"
Cohesion: 0.48
Nodes (5): getComponentsNames(), main(), mountInstallShadcnInstallCommand(), runCommand(), spawnCrossPlatformChild()

## Knowledge Gaps
- **8 isolated node(s):** `Made by LuanRoger Attribution`, `Documentation Nav Link`, `Home Page Nav Link`, `Second Page Nav Link`, `Version Label v1.3.0` (+3 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 213 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@orpc/server` connect `Electron Main & oRPC Server` to `Drizzle ORM & Customer Schema`, `Package Metadata & Tooling`, `IPC Client & Customer Actions`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **What connects `Made by LuanRoger Attribution`, `Documentation Nav Link`, `Home Page Nav Link` to the rest of the system?**
  _8 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Drizzle ORM & Customer Schema` be split into smaller, more focused modules?**
  _Cohesion score 0.05875706214689266 - nodes in this community are weakly interconnected._
- **Why does `devDependencies` connect `Dev Dependencies & Build` to `React Type Definitions`, `Ultracite Linter`, `Drizzle ORM & Customer Schema`, `Vitest Coverage Provider`, `Electron Main & oRPC Server`, `Electron Forge Packaging`, `Package Metadata & Tooling`, `Vite Build Plugins`, `jest-dom Test Setup`, `Electron Forge CLI`, `GitHub Publisher Plugin`, `jsdom Test Environment`, `Tailwind CSS`, `React Testing Library`, `Babel Type Packages`, `better-sqlite3 Type Definitions`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Should `React UI Libraries` be split into smaller, more focused modules?**
  _Cohesion score 0.07401129943502825 - nodes in this community are weakly interconnected._
- **Why does `react` connect `React UI Libraries` to `Package Metadata & Tooling`, `Theme & Language Actions`, `IPC Client & Customer Actions`, `Runtime Dependencies`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Should `SQLite Native & E2E Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.06866002214839424 - nodes in this community are weakly interconnected._