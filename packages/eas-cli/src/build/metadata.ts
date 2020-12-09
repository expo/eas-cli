import { CredentialsSource, DistributionType } from '@expo/eas-json';

import { getAppIdentifierAsync } from '../project/projectUtils';
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
    appVersion: ctx.commandCtx.exp.version!,
    cliVersion: packageJSON.version,
    workflow: ctx.buildProfile.workflow,
    credentialsSource,
    sdkVersion: ctx.commandCtx.exp.sdkVersion,
    trackingContext: ctx.trackingCtx,
    distribution: ctx.buildProfile.distribution ?? DistributionType.STORE,
    appName: ctx.commandCtx.exp.name,
    appIdentifier:
      (await getAppIdentifierAsync(ctx.commandCtx.projectDir, ctx.platform)) ?? undefined,
  };
}
