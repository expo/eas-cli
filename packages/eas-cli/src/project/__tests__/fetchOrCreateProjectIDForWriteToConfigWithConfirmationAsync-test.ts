import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { jester } from '../../credentials/__tests__/fixtures-constants';
import { fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync } from '../fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';

describe(fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync, () => {
  it.each([
    { accounts: jester.accounts, eligibleAccounts: ['jester'] },
    { accounts: [], eligibleAccounts: [] },
  ])(
    'only suggests linking when the owner cannot create projects',
    async ({ accounts, eligibleAccounts }) => {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      await expect(
        fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync(
          graphqlClient,
          { accountName: 'fake', projectName: 'fake' },
          { nonInteractive: true },
          { ...jester, accounts }
        )
      ).rejects.toMatchObject({
        accountName: 'fake',
        eligibleAccounts,
        message:
          `EAS project not configured. This command cannot configure it in non-interactive mode. ` +
          `To link an existing project:\n\n` +
          `  eas init --id <project-id> --non-interactive`,
      });
    }
  );
});
