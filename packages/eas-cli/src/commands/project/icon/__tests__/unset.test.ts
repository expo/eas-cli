import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppMutation } from '../../../../graphql/mutations/AppMutation';
import Log from '../../../../log';
import ProjectIconUnset from '../unset';

jest.mock('../../../../graphql/mutations/AppMutation');
jest.mock('../../../../log');

describe(ProjectIconUnset, () => {
  it('removes the icon of the current project', async () => {
    const graphqlClient = {} as ExpoGraphqlClient;
    jest
      .mocked(AppMutation.removeProfileImageAsync)
      .mockResolvedValue({ id: 'project-123', fullName: '@test-account/test-project' });

    const command = new ProjectIconUnset([], getMockOclifConfig());
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      projectId: 'project-123',
      loggedIn: { graphqlClient },
    });
    await command.runAsync();

    expect(AppMutation.removeProfileImageAsync).toHaveBeenCalledWith(graphqlClient, 'project-123');
    expect(jest.mocked(Log.withTick).mock.calls.flat().join()).toContain(
      '@test-account/test-project'
    );
  });
});
