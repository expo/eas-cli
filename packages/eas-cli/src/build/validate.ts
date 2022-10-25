import { Platform, Workflow } from '@expo/eas-build-job';
import { Errors } from '@oclif/core';
import fs from 'fs-extra';
import path from 'path';

import Log, { learnMore } from '../log';
import {
  ImageNonPngError,
  ImageTransparencyError,
  ensurePNGIsNotTransparentAsync,
  isPNGAsync,
} from '../utils/image';
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

export async function validateIconForManagedProjectAsync<T extends Platform>(
  ctx: CommonContext<T>
): Promise<void> {
  if (ctx.workflow !== Workflow.MANAGED) {
    return;
  }

  if (ctx.platform === Platform.ANDROID) {
    await validateAndroidIconAsync(ctx as CommonContext<Platform.ANDROID>);
  } else {
    await validateIosIconAsync(ctx as CommonContext<Platform.IOS>);
  }
}

async function validateAndroidIconAsync(ctx: CommonContext<Platform.ANDROID>): Promise<void> {
  if (!ctx.exp.android?.adaptiveIcon?.foregroundImage) {
    return;
  }

  const { foregroundImage } = ctx.exp.android.adaptiveIcon;
  if (!foregroundImage.endsWith('.png')) {
    Log.error(`The Android Adaptive Icon foreground image must be a PNG file.`);
    Log.error(`"expo.android.adaptiveIcon.foregroundImage" = ${foregroundImage}`);
    Errors.exit(1);
  }

  if (!(await isPNGAsync(foregroundImage))) {
    Log.error(`The Android Adaptive Icon foreground image must be a PNG file.`);
    Log.error(`${foregroundImage} is not valid PNG`);
    Errors.exit(1);
  }
}

async function validateIosIconAsync(ctx: CommonContext<Platform.IOS>): Promise<void> {
  const icon = ctx.exp.ios?.icon ?? ctx.exp.icon;
  if (!icon) {
    return;
  }
  const iconConfigPath = `expo${ctx.exp.ios?.icon ? '.ios' : ''}.icon`;

  if (!icon.endsWith('.png')) {
    Log.error(`The iOS app icon must be a PNG file.`);
    Log.error(`"${iconConfigPath}" = ${icon}`);
    Errors.exit(1);
  }

  try {
    await ensurePNGIsNotTransparentAsync(icon);
  } catch (err: any) {
    if (err instanceof ImageNonPngError) {
      Log.error(`The iOS app icon must be a PNG file.`);
      Log.error(`"${iconConfigPath}" = ${icon}`);
      Errors.exit(1);
    } else if (err instanceof ImageTransparencyError) {
      Log.error(
        `Your iOS app icon (${iconConfigPath}) can't have transparency if you wish to upload your app to the Apple App Store.`
      );
      Log.error(learnMore('https://expo.fyi/remove-alpha-channel', { dim: false }));
      Errors.exit(1);
    } else {
      throw err;
    }
  }
}
