import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { jester } from '../../credentials/__tests__/fixtures-constants';
import { fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync } from '../fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';

describe(fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync, () => {
  it('throws when non-interactive is specified but interaction is required', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    await expect(
      fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync(
        graphqlClient,
        { accountName: 'fake', projectName: 'fake' },
        { nonInteractive: true },
        jester
      )
    ).rejects.toThrow(
      `EAS project not configured. To configure it non-interactively, choose the account that should own the project and run:\n\n  eas init --account <name> --non-interactive\n\nAccounts you can create projects in: jester\n\nAlternatively, set the "owner" field in your app config, or run "eas init" for interactive setup.`
    );
  });
});
