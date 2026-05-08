import { Platform, Workflow } from '@expo/eas-build-job';
import { Errors } from '@oclif/core';
import fs from 'fs-extra';
import path from 'path';
import resolveFrom from 'resolve-from';
import semver from 'semver';

import { CommonContext } from './context';
import Log, { learnMore } from '../log';
import { isPNGAsync } from '../utils/image';

export function checkNodeEnvVariable(ctx: CommonContext<Platform>): void {
  if (ctx.env?.NODE_ENV === 'production') {
    Log.warn(
      'You set NODE_ENV=production in the build profile or environment variables. Remember that it will be available during the entire build process. In particular, it will make yarn/npm install only production packages.'
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
  const googleServicesEnvVar =
    ctx.platform === Platform.ANDROID
      ? ctx.env.GOOGLE_SERVICES_JSON
      : ctx.env.GOOGLE_SERVICES_INFO_PLIST;
  const rootDir = path.normalize(await ctx.vcsClient.getRootPathAsync());
  const absGoogleServicesFilePath = path.resolve(ctx.projectDir, googleServicesFilePath);
  if (
    (await fs.pathExists(absGoogleServicesFilePath)) &&
    (!isInsideDirectory(absGoogleServicesFilePath, rootDir) ||
      (await ctx.vcsClient.isFileIgnoredAsync(
        path.relative(rootDir, absGoogleServicesFilePath)
      ))) &&
    !googleServicesEnvVar
  ) {
    Log.warn(
      `File specified via "${ctx.platform}.googleServicesFile" field in your app.json is not checked in to your repository and won't be uploaded to the builder.`
    );
    Log.warn(
      `Use EAS file environment variables with secret or sensitive visibility to pass all values that you don't want to include in your version control to build process. ${learnMore(
        'https://docs.expo.dev/eas/environment-variables/#file-environment-variables'
      )}`
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
      pngPath: (ctx.exp as Record<string, any>).notification?.icon,
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

/**
 * Compose Compiler versions bundled by expo-modules-core and their required Kotlin versions.
 */
const COMPOSE_KOTLIN_COMPAT: Record<string, string> = {
  '1.5.15': '1.9.25',
  '1.5.14': '1.9.24',
};

/**
 * Maps expo-modules-core version ranges to the Compose Compiler version they bundle.
 */
function getComposeCompilerVersion(expoModulesCoreVersion: string): string | null {
  if (semver.satisfies(expoModulesCoreVersion, '~1.12.0')) {
    return '1.5.15';
  }
  return null;
}

/**
 * Attempts to read the project Kotlin version from gradle.properties or build.gradle.
 */
async function resolveProjectKotlinVersionAsync(projectDir: string): Promise<string | null> {
  // Try android/gradle.properties first
  const gradlePropertiesPath = path.join(projectDir, 'android', 'gradle.properties');
  if (await fs.pathExists(gradlePropertiesPath)) {
    const content = await fs.readFile(gradlePropertiesPath, 'utf8');
    const match = content.match(/kotlinVersion\s*=\s*(\S+)/);
    if (match) {
      return match[1];
    }
  }

  // Fall back to android/build.gradle
  const buildGradlePath = path.join(projectDir, 'android', 'build.gradle');
  if (await fs.pathExists(buildGradlePath)) {
    const content = await fs.readFile(buildGradlePath, 'utf8');
    const pluginMatch = content.match(
      /org\.jetbrains\.kotlin:kotlin-gradle-plugin:(\d+\.\d+\.\d+)/
    );
    if (pluginMatch) {
      return pluginMatch[1];
    }
    const extMatch = content.match(/ext\.kotlinVersion\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
    if (extMatch) {
      return extMatch[1];
    }
  }

  return null;
}

export async function checkComposeKotlinCompatibilityAsync(
  ctx: CommonContext<Platform.ANDROID>
): Promise<void> {
  if (ctx.workflow !== Workflow.GENERIC) {
    return;
  }

  const maybePackageJson = resolveFrom.silent(ctx.projectDir, 'expo-modules-core/package.json');
  if (!maybePackageJson) {
    return;
  }

  const { version: expoModulesCoreVersion } = await fs.readJson(maybePackageJson);
  if (!expoModulesCoreVersion) {
    return;
  }

  const composeVersion = getComposeCompilerVersion(expoModulesCoreVersion);
  if (!composeVersion) {
    return;
  }

  const requiredKotlin = COMPOSE_KOTLIN_COMPAT[composeVersion];
  if (!requiredKotlin) {
    return;
  }

  const projectKotlin = await resolveProjectKotlinVersionAsync(ctx.projectDir);
  if (!projectKotlin) {
    return;
  }

  if (projectKotlin !== requiredKotlin) {
    Log.warn(
      `Kotlin version mismatch: your project uses Kotlin ${projectKotlin}, but expo-modules-core requires Kotlin ${requiredKotlin} (for Compose Compiler ${composeVersion}).`
    );
    Log.warn('This will cause "compileReleaseKotlin" build failures.');
    Log.warn(
      `Update the Kotlin version in android/gradle.properties to ${requiredKotlin},`
    );
    Log.warn('or run "npx expo prebuild --clean" to regenerate the native project.');
    Log.newLine();
  }
}
