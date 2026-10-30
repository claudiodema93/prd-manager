import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";

const betterSqlite3Source = path.resolve(
  import.meta.dirname,
  "node_modules/better-sqlite3"
);

/**
 * better-sqlite3 is Node-API and ships one prebuilt `.node` binary per
 * platform/arch, so only the binary for the target being packaged is needed.
 * Linux packages may run against either glibc or musl, and the runtime picks
 * the variant dynamically, so both are shipped.
 */
function getPrebuildsFor(platform: string, arch: string): string[] {
  const prebuilds = [`${platform}-${arch}.node`];

  if (platform === "linux") {
    prebuilds.push(`linuxmusl-${arch}.node`);
  }

  return prebuilds;
}

/*
 * Playwright attaches to the packaged app's main process through the Node
 * inspector (`--inspect`), which the hardened fuse disables. E2E builds opt
 * in with APP_E2E=1; release builds keep the fuse disabled.
 */
const isE2EBuild = process.env.APP_E2E === "1";

const config: ForgeConfig = {
  hooks: {
    // The Vite plugin only copies the `.vite` output, so runtime dependencies
    // that are externalized from the bundle (native modules) must be added here.
    packageAfterCopy: async (
      _forgeConfig,
      buildPath,
      _electronVersion,
      platform,
      arch
    ) => {
      const destination = path.join(
        buildPath,
        "node_modules",
        "better-sqlite3"
      );
      const prebuilds = getPrebuildsFor(platform, arch);
      const missing = prebuilds.filter(
        (prebuild) =>
          !fsSync.existsSync(
            path.join(betterSqlite3Source, "prebuilds", prebuild)
          )
      );

      if (missing.length > 0) {
        throw new Error(
          `better-sqlite3 is missing prebuilt binaries for ${platform}-${arch}: ${missing.join(
            ", "
          )}. Expected them under "${path.join(betterSqlite3Source, "prebuilds")}".`
        );
      }

      await fs.mkdir(path.join(destination, "prebuilds"), { recursive: true });
      await fs.copyFile(
        path.join(betterSqlite3Source, "package.json"),
        path.join(destination, "package.json")
      );
      await fs.cp(
        path.join(betterSqlite3Source, "lib"),
        path.join(destination, "lib"),
        {
          recursive: true,
        }
      );

      await Promise.all(
        prebuilds.map((prebuild) =>
          fs.copyFile(
            path.join(betterSqlite3Source, "prebuilds", prebuild),
            path.join(destination, "prebuilds", prebuild)
          )
        )
      );
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  packagerConfig: {
    asar: true,
    extraResource: [path.resolve(import.meta.dirname, "drizzle")],
  },
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          config: "vite.main.config.mts",
          entry: "src/main.ts",
          target: "main",
        },
        {
          config: "vite.preload.config.mts",
          entry: "src/preload.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          config: "vite.renderer.config.mts",
          name: "main_window",
        },
      ],
    }),

    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: isE2EBuild,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  publishers: [
    {
      config: {
        draft: true,
        prerelease: false,
        repository: {
          name: "prd-manager",
          owner: "claudiodema93",
        },
      },
      /*
       * Publish release on GitHub as draft.
       * Remember to manually publish it on GitHub website after verifying everything is correct.
       */
      name: "@electron-forge/publisher-github",
    },
  ],
  rebuildConfig: {
    // better-sqlite3 is Node-API and ships prebuilt binaries per platform.
    ignoreModules: ["better-sqlite3"],
  },
};

export default config;
