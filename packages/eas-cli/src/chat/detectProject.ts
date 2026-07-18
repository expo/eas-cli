import { getConfigFilePaths } from '@expo/config';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { findProjectDirAndVerifyProjectSetupAsync } from '../commandUtils/context/contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { AppQuery } from '../graphql/queries/AppQuery';
import { getPrivateExpoConfigAsync } from '../project/expoConfig';

export async function detectCurrentProjectAsync(
  graphqlClient: ExpoGraphqlClient
): Promise<{ accountName: string; label: string } | null> {
  let projectDir: string;
  try {
    projectDir = await findProjectDirAndVerifyProjectSetupAsync();
  } catch {
    return null;
  }
  if (!projectDir) {
    return null;
  }

  const configPaths = getConfigFilePaths(projectDir);
  if (!configPaths.staticConfigPath && !configPaths.dynamicConfigPath) {
    return null;
  }

  let projectId: unknown;
  try {
    const exp = await getPrivateExpoConfigAsync(projectDir);
    projectId = exp.extra?.eas?.projectId;
  } catch {
    return null;
  }
  if (typeof projectId !== 'string' || !projectId) {
    return null;
  }

  try {
    const app = await AppQuery.byIdAsync(graphqlClient, projectId);
    return { accountName: app.ownerAccount.name, label: app.fullName };
  } catch {
    return null;
  }
}
