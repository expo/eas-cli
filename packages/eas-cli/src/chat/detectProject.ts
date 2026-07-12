import { getConfigFilePaths } from '@expo/config';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { findProjectDirAndVerifyProjectSetupAsync } from '../commandUtils/context/contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { AppQuery } from '../graphql/queries/AppQuery';
import { getPrivateExpoConfigAsync } from '../project/expoConfig';

/**
 * Best-effort detection of the EAS project for the current directory, used to auto-scope `eas chat`.
 *
 * This is intentionally silent and read-only: it never prompts, never creates or links a project,
 * and returns `null` (rather than throwing) when the directory is not an already-linked EAS project.
 * A missing project just means the chat stays account-scoped.
 */
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

  // Only read the config if one already exists; getPrivateExpoConfigAsync would otherwise create an
  // app.json, which chat must never do.
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
