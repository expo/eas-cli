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
      `Must configure EAS project by running 'eas init' before this command can be run in non-interactive mode.`
    );
  });
});
