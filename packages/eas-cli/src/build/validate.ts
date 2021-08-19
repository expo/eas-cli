import { Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';

import Log, { learnMore } from '../log';
import vcs from '../vcs';
import { BuildContext } from './context';
import { Platform } from './types';

export function checkNodeEnvVariable(ctx: BuildContext<Platform>) {
  if (ctx.buildProfile.env?.NODE_ENV === 'production') {
    Log.warn(
      'You are setting environment variable NODE_ENV=production, remember that it will be available during entire build process and will affect among other things what yarn/npm packages will be installed.'
    );
    Log.newLine();
  }
}

export async function checkGoogleServicesFileAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<void> {
  if (ctx.workflow === Workflow.GENERIC || ctx.buildProfile?.env?.GOOGLE_SERVICES_FILE) {
    return;
  }
  const googleServicesFilePath = ctx.exp[ctx.platform]?.googleServicesFile;
  if (!googleServicesFilePath) {
    return;
  }
  const rootDir = await vcs.getRootPathAsync();
  const absGoogleServicesFilePath = path.resolve(ctx.projectDir, googleServicesFilePath);
  if (
    (await fs.pathExists(googleServicesFilePath)) &&
    ((await vcs.isFileIgnoredAsync(googleServicesFilePath)) ||
      !isInsideDirectory(absGoogleServicesFilePath, rootDir))
  ) {
    Log.warn(
      `File specified via "${ctx.platform}.googleServicesFile" field in your app.json is not commited into your repository and won't be uploaded to the builder.`
    );
    Log.warn(
      `Use EAS Secret to pass all values that you don't want to include in your version control. ${learnMore(
        'https://docs.expo.dev/build-reference/variables/#using-secrets-in-environment-variables'
      )}`
    );
    Log.warn(
      'If you are using that file for compatibility with classic build service you can silence this warning by setting GOOGLE_SERVICES_FILE in your build profile in eas.json to any non falsy value.'
    );
    Log.newLine();
  }
}

function isInsideDirectory(file: string, directory: string): boolean {
  let lastPath = file;
  while (path.dirname(lastPath) !== lastPath) {
    if (lastPath === directory) {
      return true;
    }
    lastPath = path.dirname(lastPath);
  }
  return false;
}
