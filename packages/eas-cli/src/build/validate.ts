import { Platform, Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';

import Log, { learnMore } from '../log';
import vcs from '../vcs';
import { BuildContext } from './context';

export function checkNodeEnvVariable(ctx: BuildContext<Platform>): void {
  if (ctx.buildProfile.env?.NODE_ENV === 'production') {
    Log.warn(
      'You set NODE_ENV=production in the build profile. Remember that it will be available during the entire build process. In particular, it will make yarn/npm install only production packages.'
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
  const rootDir = path.normalize(await vcs().getRootPathAsync());
  const absGoogleServicesFilePath = path.resolve(ctx.projectDir, googleServicesFilePath);
  if (
    (await fs.pathExists(absGoogleServicesFilePath)) &&
    (!isInsideDirectory(absGoogleServicesFilePath, rootDir) ||
      (await vcs().isFileIgnoredAsync(path.relative(rootDir, absGoogleServicesFilePath))))
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
      'If you are using that file for compatibility with the classic build service (expo build) you can silence this warning by setting GOOGLE_SERVICES_FILE in your build profile in eas.json to any non-falsy value.'
    );
    Log.newLine();
  }
}

function isInsideDirectory(file: string, directory: string): boolean {
  return file.startsWith(directory);
}
