import { ExpoConfig } from '@expo/config';
import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { ensureEASUpdateIsConfiguredAsync } from '../../../update/configure';

describe(ensureEASUpdateIsConfiguredAsync, () => {
  it('errors with "useClassicUpdates" set', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>({}));
    const exp: ExpoConfig = {
      name: 'test',
      slug: 'test',
      updates: { useClassicUpdates: true },
    };

    await expect(async () => {
      await ensureEASUpdateIsConfiguredAsync(graphqlClient, {
        exp,
        projectId: 'test',
        projectDir: '/tmp/test',
        platform: null,
      });
    }).rejects.toThrow(
      `Your app config sets "updates.useClassicUpdates" but EAS Update does not support classic updates. Remove "useClassicUpdates" from your app config and run this command again.`
    );
  });
});
