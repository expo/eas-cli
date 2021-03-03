import { CredentialsSource } from '@expo/eas-json';

import { getAppIdentifierAsync } from '../project/projectUtils';
import { gitCommitHashAsync } from '../utils/git';
import { BuildContext } from './context';
import { BuildMetadata, Platform } from './types';

/**
 * We use require() to exclude package.json from TypeScript's analysis since it lives outside
 * the src directory and would change the directory structure of the emitted files
 * under the build directory
 */
const packageJSON = require('../../package.json');

export async function collectMetadata<T extends Platform>(
  ctx: BuildContext<T>,
  {
    credentialsSource,
  }: {
    credentialsSource?: CredentialsSource.LOCAL | CredentialsSource.REMOTE;
  }
): Promise<BuildMetadata> {
  return {
    trackingContext: ctx.trackingCtx,
    appVersion: ctx.commandCtx.exp.version!,
    cliVersion: packageJSON.version,
    workflow: ctx.buildProfile.workflow,
    credentialsSource,
    sdkVersion: ctx.commandCtx.exp.sdkVersion,
    releaseChannel: ctx.buildProfile.releaseChannel,
    distribution: ctx.buildProfile.distribution ?? 'store',
    appName: ctx.commandCtx.exp.name,
    appIdentifier:
      (await getAppIdentifierAsync(ctx.commandCtx.projectDir, ctx.platform)) ?? undefined,
    buildProfile: ctx.commandCtx.profile,
    gitCommitHash: await gitCommitHashAsync(),
  };
}
