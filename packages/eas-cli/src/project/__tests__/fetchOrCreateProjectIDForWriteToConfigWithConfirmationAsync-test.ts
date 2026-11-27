import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { jester } from '../../credentials/__tests__/fixtures-constants';
import { AppMutation } from '../../graphql/mutations/AppMutation';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { confirmAsync } from '../../prompts';
import { fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync } from '../fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';

jest.mock('../../graphql/mutations/AppMutation');
jest.mock('../../graphql/queries/AppQuery');
jest.mock('../../prompts');
jest.mock('../../ora', () => ({
  ora: () => ({ start: () => ({ succeed: jest.fn(), fail: jest.fn() }) }),
}));

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

  it('creates the project with the display name from the app config', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest.mocked(AppQuery.byFullNameAsync).mockRejectedValue(new Error('not found'));
    jest.mocked(confirmAsync).mockResolvedValue(true);
    jest.mocked(AppMutation.createAppAsync).mockResolvedValue('new-project-id');

    await expect(
      fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync(
        graphqlClient,
        { accountName: 'jester', projectName: 'my-app', displayName: 'My App' },
        { nonInteractive: false },
        jester
      )
    ).resolves.toBe('new-project-id');

    expect(jest.mocked(AppMutation.createAppAsync).mock.calls[0][1]).toEqual({
      accountId: 'jester-account-id',
      projectName: 'my-app',
      displayName: 'My App',
    });
  });
});
