# PrdManager

Desktop application for managing product requirement documents, built with Electron, React, and a local SQLite cache.

## Libs and tools

### Core 🏍️

- [Electron](https://www.electronjs.org)
- [Vite](https://vitejs.dev)

### DX 🛠️

- [TypeScript](https://www.typescriptlang.org)
- [oRPC](https://orpc.unnoq.com)
- [Ultracite with Biome](https://www.ultracite.ai/providers/biome)
- [Zod](https://zod.dev)
- [React Query (TanStack)](https://tanstack.com/query)

### UI 🎨

- [React](https://reactjs.org)
- [Tailwind CSS](https://tailwindcss.com)
- [Shadcn UI](https://ui.shadcn.com)
- [Geist](https://vercel.com/font) as default font
- [i18next](https://www.i18next.com)
- [TanStack Router](https://tanstack.com/router) (file based routing)
- [Lucide](https://lucide.dev)

### Test 🧪

- [Vitest](https://vitest.dev)
- [Playwright](https://playwright.dev)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro)

### Packing and distribution 📦

- [Electron Forge](https://www.electronforge.io)

### CI/CD 🚀

- GitHub Actions for checks, unit/e2e tests, and releases.

## Project preferences 🎯

- Context isolation, `nodeIntegration: false`, and Electron's sandbox enabled.
- [React Compiler](https://react.dev/learn/react-compiler) is enabled by default.
- `titleBarStyle`: hidden (custom title bar).
- Geist as default font.
- React DevTools are installed in development.

## How to use

1. Clone the repository

```bash
git clone https://github.com/claudiodema93/prd-manager.git
```

2. Install dependencies

```bash
npm install
```

3. Run the app

```bash
npm run start
```

Now you can go directly to `/src/routes/index.tsx` and modify the app as you want.

## Database

The app keeps a SQLite cache in the Electron `userData` directory (`cache.db`), managed with Drizzle ORM and better-sqlite3 in the main process.

- The database is a disposable cache. A damaged file is reset in place (tables dropped and migrations re-applied) or, when that is not possible, moved aside as `cache.db.corrupt-<timestamp>`. The file is **never deleted**, and files that are not SQLite databases are never modified.
- An `application_id` sentinel prevents the app from touching another application's SQLite database.
- Set `SAUGER_CACHE_DB_PATH` to use a different file (absolute path, or `:memory:` in tests).
- The startup integrity check can be skipped in development for large caches with `SAUGER_CACHE_SKIP_INTEGRITY_CHECK=1`; packaged builds always check.
- The schema lives in `src/db/schema.ts`. After changing it, run `npm run db:generate` and commit the generated `drizzle/` folder.
- Migrations are applied automatically on startup and shipped in packaged builds through `extraResource`.
- Database rows are exposed to the renderer only through oRPC procedures (`src/ipc/customers` → `src/actions/customers.ts`).

## Auto update

The auto update uses GitHub Releases from [claudiodema93/prd-manager](https://github.com/claudiodema93/prd-manager) as the update source. The `publish` script creates a new release with the version specified in `package.json`.

> [!WARNING]
> Auto update only works with public repositories. Use a custom update server for private repositories.

You can also use the GitHub Actions workflow to create a new release. The workflow has to be triggered manually and creates a draft release by default, so you can review it before publishing.

> Check the [`.github/workflows/publish.yaml`](https://github.com/claudiodema93/prd-manager/blob/main/.github/workflows/publish.yaml) file for more details.

The implementation uses [update-electron-app](https://github.com/electron/update-electron-app) and the [Electron Forge GitHub publisher](https://www.electronforge.io/config/publishers/github).

## License

This project is licensed under the MIT License — see the [LICENSE](https://github.com/claudiodema93/prd-manager/blob/main/LICENSE) file for details.
