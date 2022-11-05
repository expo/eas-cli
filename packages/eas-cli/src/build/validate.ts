import { Platform, Workflow } from '@expo/eas-build-job';
import { Errors } from '@oclif/core';
import fs from 'fs-extra';
import path from 'path';
import semver from 'semver';

import Log, { learnMore } from '../log';
import { isPNGAsync } from '../utils/image';
import { getVcsClient } from '../vcs';
import { CommonContext } from './context';

export function checkNodeEnvVariable(ctx: CommonContext<Platform>): void {
  if (ctx.buildProfile.env?.NODE_ENV === 'production') {
    Log.warn(
      'You set NODE_ENV=production in the build profile. Remember that it will be available during the entire build process. In particular, it will make yarn/npm install only production packages.'
    );
    Log.newLine();
  }
}

export async function checkGoogleServicesFileAsync<T extends Platform>(
  ctx: CommonContext<T>
): Promise<void> {
  if (ctx.workflow === Workflow.GENERIC || ctx.buildProfile?.env?.GOOGLE_SERVICES_FILE) {
    return;
  }
  const googleServicesFilePath = ctx.exp[ctx.platform]?.googleServicesFile;
  if (!googleServicesFilePath) {
    return;
  }
  const rootDir = path.normalize(await getVcsClient().getRootPathAsync());
  const absGoogleServicesFilePath = path.resolve(ctx.projectDir, googleServicesFilePath);
  if (
    (await fs.pathExists(absGoogleServicesFilePath)) &&
    (!isInsideDirectory(absGoogleServicesFilePath, rootDir) ||
      (await getVcsClient().isFileIgnoredAsync(path.relative(rootDir, absGoogleServicesFilePath))))
  ) {
    Log.warn(
      `File specified via "${ctx.platform}.googleServicesFile" field in your app.json is not checked in to your repository and won't be uploaded to the builder.`
    );
    Log.warn(
      `Use EAS Secret to pass all values that you don't want to include in your version control. ${learnMore(
        'https://docs.expo.dev/build-reference/variables/#using-secrets-in-environment-variables'
      )}`
    );
    Log.warn(
      `If you are using that file for compatibility with the classic build service (expo build) you can silence this warning by setting your build profile's env.GOOGLE_SERVICES_FILE in eas.json to any non-empty string.`
    );
    Log.newLine();
  }
}

function isInsideDirectory(file: string, directory: string): boolean {
  return file.startsWith(directory);
}

export async function validatePNGsForManagedProjectAsync<T extends Platform>(
  ctx: CommonContext<T>
): Promise<void> {
  if (ctx.workflow !== Workflow.MANAGED) {
    return;
  }

  // don't run PNG checks on SDK 47 and newer
  // see https://github.com/expo/eas-cli/pull/1477#issuecomment-1293914917
  if (!ctx.exp.sdkVersion || semver.satisfies(ctx.exp.sdkVersion, '>= 47.0.0')) {
    return;
  }

  if (ctx.platform === Platform.ANDROID) {
    await validateAndroidPNGsAsync(ctx as CommonContext<Platform.ANDROID>);
  }
  // Validating iOS PNGs is currently disabled
  // See https://github.com/expo/eas-cli/pull/1477 for context
  //
  // else {
  //   await validateIosPNGsAsync(ctx as CommonContext<Platform.IOS>);
  // }
}

type ConfigPng = { configPath: string; pngPath: string | undefined };

async function validateAndroidPNGsAsync(ctx: CommonContext<Platform.ANDROID>): Promise<void> {
  const pngs: ConfigPng[] = [
    {
      configPath: 'exp.icon',
      pngPath: ctx.exp.icon,
    },
    {
      configPath: 'exp.android.icon',
      pngPath: ctx.exp.android?.icon,
    },
    {
      configPath: 'exp.android.adaptiveIcon.foregroundImage',
      pngPath: ctx.exp.android?.adaptiveIcon?.foregroundImage,
    },
    {
      configPath: 'exp.android.adaptiveIcon.backgroundImage',
      pngPath: ctx.exp.android?.adaptiveIcon?.backgroundImage,
    },
    {
      configPath: 'exp.splash.image',
      pngPath: ctx.exp.splash?.image,
    },
    {
      configPath: 'exp.notification.icon',
      pngPath: ctx.exp.notification?.icon,
    },
  ];
  await validatePNGsAsync(pngs);
}

// Validating iOS PNGs is currently disabled
// See https://github.com/expo/eas-cli/pull/1477 for context
//
// async function validateIosPNGsAsync(ctx: CommonContext<Platform.IOS>): Promise<void> {
//   const pngs: ConfigPng[] = [
//     {
//       configPath: 'exp.icon',
//       pngPath: ctx.exp.icon,
//     },
//     {
//       configPath: 'exp.ios.icon',
//       pngPath: ctx.exp.ios?.icon,
//     },
//     {
//       configPath: 'exp.splash.image',
//       pngPath: ctx.exp.splash?.image,
//     },
//     {
//       configPath: 'exp.notification.icon',
//       pngPath: ctx.exp.notification?.icon,
//     },
//   ];
//   await validatePNGsAsync(pngs);

//   const icon = ctx.exp.ios?.icon ?? ctx.exp.icon;
//   if (!icon) {
//     return;
//   }
//   const iconConfigPath = `expo${ctx.exp.ios?.icon ? '.ios' : ''}.icon`;

//   try {
//     await ensurePNGIsNotTransparentAsync(icon);
//   } catch (err: any) {
//     if (err instanceof ImageTransparencyError) {
//       Log.error(
//         `Your iOS app icon (${iconConfigPath}) can't have transparency if you wish to upload your app to the Apple App Store.`
//       );
//       Log.error(learnMore('https://expo.fyi/remove-alpha-channel', { dim: false }));
//       Errors.exit(1);
//     } else {
//       throw err;
//     }
//   }
// }

async function validatePNGsAsync(configPngs: ConfigPng[]): Promise<void> {
  const validationPromises = configPngs.map(configPng => validatePNGAsync(configPng));
  const validationResults = await Promise.allSettled(validationPromises);
  const failedValidations = validationResults.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );

  if (failedValidations.length === 0) {
    return;
  }

  Log.error('PNG images validation failed:');
  for (const { reason } of failedValidations) {
    const error: Error = reason;
    Log.error(`- ${error.message}`);
  }
  Errors.exit(1);
}

async function validatePNGAsync({ configPath, pngPath }: ConfigPng): Promise<void> {
  if (!pngPath) {
    return;
  }

  if (!pngPath.endsWith('.png')) {
    throw new Error(`"${configPath}" is not a PNG file`);
  }

  if (!(await isPNGAsync(pngPath))) {
    throw new Error(`"${configPath}" is not valid PNG`);
  }
}
