# Graph Report - prd-manager  (2026-10-29)

## Corpus Check
- Corpus is ~6,391 words - fits in a single context window. You may not need a graph.

## Summary
- 481 nodes · 781 edges · 32 communities (23 shown, 9 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 32 edges (avg confidence: 0.81)
- Token cost: 71,116 input · 0 output

## Community Hubs (Navigation)
- UI Component Primitives
- IPC Theme & Window APIs
- Project Overview & Stack
- Theme Actions & App Bootstrap
- CI Testing Workflow
- Runtime Dependencies
- TypeScript Configuration
- shadcn Component Config
- Package Metadata
- Dev Dependency Types
- Electron Forge Packaging
- CI Publish Workflow
- TanStack Routing
- Window Controls & Layout
- CI Check Workflow
- Package Scripts
- Demo Screenshot (Landing UI)
- Vite Build Configuration
- Shadcn UI Bump Script
- Dependabot Config
- Vitest Unit Testing
- Playwright E2E Testing
- Test Setup (jest-dom)
- Package Overrides (Fuses)
- React Compiler Plugin
- Tailwind CSS
- Testing Library React
- Testing Library User Event
- React Type Definitions
- Ultracite Linting

## God Nodes (most connected - your core abstractions)
1. `electron-shadcn Template` - 27 edges
2. `cn()` - 19 edges
3. `compilerOptions` - 19 edges
4. `scripts` - 13 edges
5. `react` - 12 edges
6. `Ultracite Code Standards` - 12 edges
7. `NavigationMenu()` - 10 edges
8. `@orpc/server` - 9 edges
9. `@tanstack/react-router` - 8 edges
10. `react-i18next` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Prettier` --semantically_similar_to--> `Biome (Underlying Lint/Format Engine)`  [INFERRED] [semantically similar]
  README.md → .github/copilot-instructions.md
- `Security Guidelines` --semantically_similar_to--> `Content Security Policy (script-src 'self')`  [INFERRED] [semantically similar]
  .github/copilot-instructions.md → index.html
- `Ultracite with Biome` --conceptually_related_to--> `Ultracite Code Standards`  [INFERRED]
  README.md → .github/copilot-instructions.md
- `Ultracite with Biome` --conceptually_related_to--> `Biome (Underlying Lint/Format Engine)`  [INFERRED]
  README.md → .github/copilot-instructions.md
- `Type Safety & Explicitness` --conceptually_related_to--> `TypeScript 6`  [INFERRED]
  .github/copilot-instructions.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Ultracite Code Standards Principle Set** — _github_copilot_instructions_ultracite, _github_copilot_instructions_type_safety, _github_copilot_instructions_modern_js_ts, _github_copilot_instructions_async_promises, _github_copilot_instructions_react_jsx, _github_copilot_instructions_error_handling, _github_copilot_instructions_code_organization, _github_copilot_instructions_security, _github_copilot_instructions_performance, _github_copilot_instructions_testing [EXTRACTED 1.00]
- **electron-shadcn Core Framework Stack** — readme_electron_shadcn, readme_electron, readme_vite, readme_typescript, readme_react, readme_tailwind, readme_shadcn_ui [INFERRED 0.85]
- **Renderer Bootstrap Flow** — index_html_entry_point, index_html_renderer_entry, index_html_global_styles, index_html_content_security_policy [EXTRACTED 1.00]
- **electron-shadcn Landing Page Composition** — images_demo_app_window, images_demo_logo_cluster, images_demo_electron_shadcn_brand, images_demo_version_label, images_demo_author_credit [EXTRACTED 0.95]
- **In-App Preference Controls (Locale and Theme)** — images_demo_language_switcher, images_demo_dark_mode_toggle, images_demo_app_window [INFERRED 0.85]

## Communities (32 total, 9 thin omitted)

### Community 0 - "UI Component Primitives"
Cohesion: 0.09
Nodes (38): class-variance-authority@^0.7.1, lucide-react@^1.63.0, radix-ui@^1.8.1, class-variance-authority, lucide-react, radix-ui, react-i18next, @tanstack/react-router (+30 more)

### Community 1 - "IPC Theme & Window APIs"
Cohesion: 0.06
Nodes (30): @orpc/server@^1.16.1, update-electron-app@^3.3.0, zod@^4.6.7, electron@^45.1.0, electron, @orpc/server, update-electron-app, zod (+22 more)

### Community 2 - "Project Overview & Stack"
Cohesion: 0.06
Nodes (33): Biome (Underlying Lint/Format Engine), Ultracite Code Standards, index.html Entry Point, Global Stylesheet (/src/styles/global.css), Renderer Entry Module (/src/renderer.ts), Auto Update, electron-shadcn Documentation Site, Electron 43 (+25 more)

### Community 3 - "Theme Actions & App Bootstrap"
Cohesion: 0.11
Nodes (18): i18next@^26.5.11, i18next, updateAppLanguage(), getCurrentTheme(), setTheme(), syncWithLocalTheme(), ThemePreferences, toggleTheme() (+10 more)

### Community 4 - "CI Testing Workflow"
Cohesion: 0.09
Nodes (26): GITHUB_TOKEN, jobs, test-e2e, tests-unit, name, on, pull_request, push (+18 more)

### Community 5 - "Runtime Dependencies"
Cohesion: 0.08
Nodes (24): dependencies, clsx@^2.1.1, electron-squirrel-startup@^1.0.1, @fontsource-variable/geist@^5.3.0, @fontsource-variable/geist-mono@^5.3.0, @icons-pack/react-simple-icons@^13.15.1, @orpc/client@^1.16.1, react@^19.3.1 (+16 more)

### Community 6 - "TypeScript Configuration"
Cohesion: 0.10
Nodes (20): compilerOptions, allowJs, allowSyntheticDefaultImports, composite, declaration, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+12 more)

### Community 7 - "shadcn Component Config"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+11 more)

### Community 8 - "Package Metadata"
Cohesion: 0.11
Nodes (18): author, description, @electron-forge/plugin-auto-unpack-natives@^8.0.1, @electron-forge/publisher-github@^8.0.1, jsdom@^30.1.2, @types/electron-squirrel-startup@^1.0.2, @types/node@^26.6.5, license (+10 more)

### Community 9 - "Dev Dependency Types"
Cohesion: 0.11
Nodes (19): devDependencies, @babel/core@^8.0.9, @biomejs/biome@^2.6.3, electron-devtools-installer@^4.0.0, @electron-forge/cli@^8.0.1, tsx@^4.23.15, tw-animate-css@^1.4.0, @types/babel__core@^7.20.5 (+11 more)

### Community 10 - "Electron Forge Packaging"
Cohesion: 0.11
Nodes (17): config, @electron-forge/maker-deb@^8.0.1, @electron-forge/maker-rpm@^8.0.1, @electron-forge/maker-squirrel@^8.0.1, @electron-forge/maker-zip@^8.0.1, @electron-forge/plugin-fuses@^8.0.1, @electron-forge/plugin-vite@^8.0.1, @electron-forge/shared-types@^8.0.1 (+9 more)

### Community 11 - "CI Publish Workflow"
Cohesion: 0.11
Nodes (17): GITHUB_TOKEN, jobs, publish-release, name, on, workflow_dispatch, contents, permissions (+9 more)

### Community 12 - "TanStack Routing"
Cohesion: 0.14
Nodes (16): Route, Route, Route, FileRoutesByFullPath, FileRoutesById, FileRoutesByPath, FileRoutesByTo, FileRouteTypes (+8 more)

### Community 13 - "Window Controls & Layout"
Cohesion: 0.20
Nodes (13): @tanstack/react-router-devtools@^1.167.2, react, @tanstack/react-router-devtools, getPlatform(), closeWindow(), maximizeWindow(), minimizeWindow(), DragWindowRegion() (+5 more)

### Community 14 - "CI Check Workflow"
Cohesion: 0.14
Nodes (13): runs-on, steps, jobs, check, name, on, pull_request, branches (+5 more)

### Community 15 - "Package Scripts"
Cohesion: 0.15
Nodes (13): scripts, bump-ui, check, fix, make, package, publish, start (+5 more)

### Community 16 - "Demo Screenshot (Landing UI)"
Cohesion: 0.23
Nodes (12): electron-shadcn Application Window, Made by LuanRoger Attribution, Dark Mode Toggle Button, Documentation Nav Link, electron-shadcn Brand Title, Home Page Nav Link, EN-US / PT-BR Language Switcher, Electron, Vite and React Logo Cluster (+4 more)

### Community 17 - "Vite Build Configuration"
Cohesion: 0.20
Nodes (8): @tailwindcss/vite@^4.3.3, @rolldown/plugin-babel@^0.2.4, @tanstack/router-plugin@^1.168.48, vite@^8.3.5, @rolldown/plugin-babel, @tailwindcss/vite, @tanstack/router-plugin, vite

### Community 18 - "Shadcn UI Bump Script"
Cohesion: 0.39
Nodes (5): getComponentsNames(), main(), mountInstallShadcnInstallCommand(), runCommand(), spawnCrossPlatformChild()

### Community 19 - "Dependabot Config"
Cohesion: 0.29
Nodes (6): interval, updates, directory, package-ecosystem, schedule, version

### Community 20 - "Vitest Unit Testing"
Cohesion: 0.29
Nodes (4): @vitejs/plugin-react@^6.1.2, vitest@^5.0.5, @vitejs/plugin-react, vitest

### Community 21 - "Playwright E2E Testing"
Cohesion: 0.33
Nodes (4): electron-playwright-helpers@^3.1.2, @playwright/test@^1.64.1, electron-playwright-helpers, @playwright/test

### Community 23 - "Package Overrides (Fuses)"
Cohesion: 0.67
Nodes (3): @electron/fuses, overrides, @electron-forge/plugin-fuses

## Knowledge Gaps
- **12 isolated node(s):** `oRPC`, `Zod 4`, `Lucide Icons`, `update-electron-app`, `GitHub Releases Update Source` (+7 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 146 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `Dev Dependency Types` to `IPC Theme & Window APIs`, `Package Metadata`, `Electron Forge Packaging`, `Vite Build Configuration`, `Vitest Unit Testing`, `Playwright E2E Testing`, `Test Setup (jest-dom)`, `React Compiler Plugin`, `Tailwind CSS`, `Testing Library React`, `Testing Library User Event`, `React Type Definitions`, `Ultracite Linting`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **What connects `oRPC`, `Zod 4`, `Lucide Icons` to the rest of the system?**
  _12 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI Component Primitives` be split into smaller, more focused modules?**
  _Cohesion score 0.09084556254367575 - nodes in this community are weakly interconnected._
- **Why does `react` connect `Window Controls & Layout` to `Package Metadata`, `UI Component Primitives`, `Theme Actions & App Bootstrap`, `Runtime Dependencies`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Should `IPC Theme & Window APIs` be split into smaller, more focused modules?**
  _Cohesion score 0.06334841628959276 - nodes in this community are weakly interconnected._
- **Why does `@orpc/server` connect `IPC Theme & Window APIs` to `Package Metadata`, `Theme Actions & App Bootstrap`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Should `Project Overview & Stack` be split into smaller, more focused modules?**
  _Cohesion score 0.06382978723404255 - nodes in this community are weakly interconnected._