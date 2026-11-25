import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { jester } from '../../credentials/__tests__/fixtures-constants';
import { fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync } from '../fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';

describe(fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync, () => {
  it.each([
    {
      accounts: jester.accounts,
      accountsWithProjectCreationPermission: ['jester'],
      permission:
        'Accounts you can create projects in: jester\nCreating a project in fake requires a credential with permission to create projects there.',
    },
    {
      accounts: [],
      accountsWithProjectCreationPermission: [],
      permission: 'Your current credential cannot create projects in any account.',
    },
  ])(
    'shows both commands and explains create permissions: $accountsWithProjectCreationPermission',
    async ({ accounts, accountsWithProjectCreationPermission, permission }) => {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      await expect(
        fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync(
          graphqlClient,
          { accountName: 'fake', projectName: 'fake' },
          { nonInteractive: true },
          { ...jester, accounts }
        )
      ).rejects.toMatchObject({
        details: { accountName: 'fake', accountsWithProjectCreationPermission },
        message:
          `EAS project not configured. This command cannot configure it in non-interactive mode. ` +
          `Run one of the following, then re-run this command:\n\nTo link an existing project:\n\n` +
          `  eas init --id <project-id> --non-interactive\n\nTo create a new project:\n\n  eas init --account fake --non-interactive\n\n${permission}`,
      });
    }
  );
});
