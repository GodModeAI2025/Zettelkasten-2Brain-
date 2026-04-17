import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
// FusesPlugin temporaer deaktiviert — verursacht Electron-Absturz bei forge start
// import { FusesPlugin } from '@electron-forge/plugin-fuses';
// import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'zettelkasten',
    executableName: 'zettelkasten',
    icon: './assets/icon',
    appBundleId: 'com.zettelkasten.desktop',
    appCategoryType: 'public.app-category.productivity',
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({
      format: 'ULFO',
    }),
    new MakerZIP({}, ['darwin']),
    new MakerSquirrel({
      name: 'zettelkasten',
    }),
    new MakerDeb({
      options: {
        name: 'zettelkasten',
        productName: 'zettelkasten',
        genericName: 'Knowledge Management',
        categories: ['Utility', 'Office'],
      },
    }),
    new MakerRpm({}),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // FusesPlugin bei Bedarf fuer Production-Build reaktivieren
    // new FusesPlugin({
    //   version: FuseVersion.V1,
    //   [FuseV1Options.RunAsNode]: true,
    //   [FuseV1Options.EnableCookieEncryption]: true,
    //   [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    //   [FuseV1Options.EnableNodeCliInspectArguments]: false,
    //   [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    //   [FuseV1Options.OnlyLoadAppFromAsar]: false,
    // }),
  ],
};

export default config;
