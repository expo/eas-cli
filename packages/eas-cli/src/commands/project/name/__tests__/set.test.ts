import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppMutation } from '../../../../graphql/mutations/AppMutation';
import { getPrivateExpoConfigAsync } from '../../../../project/expoConfig';
import ProjectNameSet from '../set';

jest.mock('../../../../graphql/mutations/AppMutation');
jest.mock('../../../../log');
jest.mock('../../../../project/expoConfig');

const graphqlClient = {} as ExpoGraphqlClient;
const mockSetDisplayNameAsync = jest.mocked(AppMutation.setDisplayNameAsync);

async function runAsync(argv: string[]): Promise<void> {
  const command = new ProjectNameSet(argv, getMockOclifConfig());
  // @ts-expect-error getContextAsync is protected
  jest.spyOn(command, 'getContextAsync').mockResolvedValue({
    projectId: 'project-123',
    projectDir: '/app',
    loggedIn: { graphqlClient },
  });
  await command.runAsync();
}

describe(ProjectNameSet, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetDisplayNameAsync.mockResolvedValue({
      id: 'project-123',
      name: 'My App',
      fullName: '@test-account/my-app',
    });
    jest
      .mocked(getPrivateExpoConfigAsync)
      .mockResolvedValue({ name: 'Config Name', slug: 'my-app' } as any);
  });

  it('sets the given display name, trimmed', async () => {
    await runAsync(['  My App ']);

    expect(mockSetDisplayNameAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'project-123',
      displayName: 'My App',
    });
  });

  it('uses the name from the app config when no name is given', async () => {
    await runAsync([]);

    expect(mockSetDisplayNameAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'project-123',
      displayName: 'Config Name',
    });
  });

  it('rejects a blank name', async () => {
    await expect(runAsync(['   '])).rejects.toThrow('The display name cannot be blank.');
    expect(mockSetDisplayNameAsync).not.toHaveBeenCalled();
  });
});
