import { Role } from '../../graphql/generated';
import Log from '../../log';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { Actor } from '../../user/User';
import { ExpoGraphqlClient } from '../context/contextUtils/createGraphqlClient';

export async function verifyAccountPermissionsAsync(
  actor: Actor,
  accountName: string
): Promise<boolean> {
  const allAccounts = actor.accounts;
  const accountNamesWhereUserHasSufficientPermissionsToCreateApp = new Set(
    allAccounts
      .filter(a => a.users.find(it => it.actor.id === actor.id)?.role !== Role.ViewOnly)
      .map(it => it.name)
  );

  const hasPermissions = accountNamesWhereUserHasSufficientPermissionsToCreateApp.has(accountName);
  if (!hasPermissions) {
    Log.warn(`You don't have permission to create a new project on the ${accountName} account.`);
  }

  return hasPermissions;
}

export async function verifyProjectDoesNotExistAsync(
  graphqlClient: ExpoGraphqlClient,
  accountName: string,
  projectName: string,
  { silent = false }: { silent?: boolean } = {}
): Promise<boolean> {
  const existingProjectId = await findProjectIdByAccountNameAndSlugNullableAsync(
    graphqlClient,
    accountName,
    projectName
  );

  const doesNotExist = existingProjectId === null;
  if (!doesNotExist && !silent) {
    Log.warn(`Project @${accountName}/${projectName} already exists on the server.`);
  }

  return doesNotExist;
}
