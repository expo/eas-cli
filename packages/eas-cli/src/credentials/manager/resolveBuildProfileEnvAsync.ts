import { Env, Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';

import { Action } from './HelperActions';
import { resolveEnvVarsAsync } from '../../build/evaluateConfigWithEnvVarsAsync';

/**
 * Resolves the env a build profile is evaluated with: variables from its EAS
 * `environment` (file variables as temp file paths) overlaid with its `env` block,
 * the same way `eas build` does.
 */
export async function resolveBuildProfileEnvAsync<T extends Platform>(
  callingAction: Action,
  { buildProfile, buildProfileName }: { buildProfile: BuildProfile<T>; buildProfileName: string }
): Promise<Env> {
  const { projectId } = await callingAction.getDynamicPrivateProjectConfigAsync({
    env: buildProfile.env,
  });
  return await resolveEnvVarsAsync({
    buildProfile,
    buildProfileName,
    graphqlClient: callingAction.graphqlClient,
    projectId,
  });
}
