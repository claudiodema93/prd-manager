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

const config: ForgeConfig = {
  hooks: {
    // The Vite plugin only copies the `.vite` output, so runtime dependencies
    // that are externalized from the bundle (native modules) must be added here.
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const source = path.resolve(
        import.meta.dirname,
        "node_modules/better-sqlite3"
      );
      const destination = path.join(
        buildPath,
        "node_modules",
        "better-sqlite3"
      );

      await fs.cp(source, destination, { recursive: true });
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
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
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
          name: "electron-shadcn",
          owner: "LuanRoger",
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
