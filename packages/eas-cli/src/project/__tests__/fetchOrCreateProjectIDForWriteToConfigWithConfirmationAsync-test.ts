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
      `EAS project not configured. This command cannot configure it in non-interactive mode. ` +
        `Run one of the following, then re-run this command:\n\n` +
        `To link an existing project:\n\n` +
        `  eas init --id <project-id> --non-interactive\n\n` +
        `To create a new project:\n\n` +
        `  eas init --account fake --non-interactive\n\n` +
        `Accounts you can create projects in: jester`
    );
  });
});
