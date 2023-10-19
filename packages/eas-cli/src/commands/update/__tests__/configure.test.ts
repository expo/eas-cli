import { ExpoConfig } from '@expo/config';
import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { ensureEASUpdateIsConfiguredAsync } from '../../../update/configure';
import { Client } from '../../../vcs/vcs';

describe(ensureEASUpdateIsConfiguredAsync, () => {
  it('errors with "useClassicUpdates" set and no app.json', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>({}));
    const vcsClient = instance(mock<Client>({}));
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
        vcsClient,
      });
    }).rejects.toThrow(
      `Your app config sets "updates.useClassicUpdates" but EAS Update does not support classic updates. Remove "useClassicUpdates" from your app config and run this command again.`
    );
  });
});
