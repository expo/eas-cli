import { mockTestCommand } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { GitHubRepositoryAppQuery } from '../../../../graphql/generated';
import { GitHubRepositoryQuery } from '../../../../graphql/queries/GitHubRepositoryQuery';
import Log from '../../../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsGitHubStatus from '../status';

jest.mock('../../../../graphql/queries/GitHubRepositoryQuery');
jest.mock('../../../../log');
jest.mock('../../../../utils/json');

describe(IntegrationsGitHubStatus, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const app: GitHubRepositoryAppQuery['app']['byId'] = {
    id: 'project-id',
    fullName: '@expo/mobile',
    ownerAccount: { id: 'account-id', name: 'expo' },
    githubRepository: null,
    githubRepositorySettings: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(GitHubRepositoryQuery.getAppAsync).mockResolvedValue(app);
  });

  it('reports a disconnected project', async () => {
    await mockTestCommand(IntegrationsGitHubStatus, [], {
      projectId: app.id,
      loggedIn: { graphqlClient },
    }).runAsync();
    expect(Log.log).toHaveBeenCalledWith('@expo/mobile is not connected to a GitHub repository.');
  });

  it('prints disconnected status as JSON', async () => {
    await mockTestCommand(IntegrationsGitHubStatus, ['--json'], {
      projectId: app.id,
      loggedIn: { graphqlClient },
    }).runAsync();
    expect(enableJsonOutput).toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      projectId: app.id,
      projectFullName: app.fullName,
      connected: false,
      repository: null,
      baseDirectory: null,
    });
    expect(Log.log).not.toHaveBeenCalled();
  });

  it('propagates server errors', async () => {
    jest
      .mocked(GitHubRepositoryQuery.getAppAsync)
      .mockRejectedValue(new Error('Permission denied'));
    await expect(
      mockTestCommand(IntegrationsGitHubStatus, ['--json'], {
        projectId: app.id,
        loggedIn: { graphqlClient },
      }).runAsync()
    ).rejects.toThrow('Permission denied');
    expect(printJsonOnlyOutput).not.toHaveBeenCalled();
  });
});
