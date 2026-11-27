import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import Log from '../../../log';
import ProjectInfo from '../info';

jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../log');

const projectId = 'test-project-id';

async function runAndGetOutputAsync(): Promise<string> {
  const command = new ProjectInfo([], getMockOclifConfig());
  // @ts-expect-error getContextAsync is protected
  jest.spyOn(command, 'getContextAsync').mockResolvedValue({
    projectId,
    loggedIn: { graphqlClient: {} as ExpoGraphqlClient },
  });
  await command.runAsync();
  return jest.mocked(Log.log).mock.calls.flat().join('\n');
}

describe(ProjectInfo, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
      id: projectId,
      name: 'My App',
      fullName: '@jester/my-app',
      slug: 'my-app',
    } as any);
  });

  it('prints the display name, slug and icon URL', async () => {
    jest
      .mocked(AppQuery.byIdProfileImageUrlAsync)
      .mockResolvedValue('https://example.com/icon.png');

    const output = await runAndGetOutputAsync();

    expect(output).toMatch(/fullName.* @jester\/my-app/);
    expect(output).toMatch(/name.* My App/);
    expect(output).toMatch(/slug.* my-app/);
    expect(output).toMatch(/icon.* https:\/\/example\.com\/icon\.png/);
    expect(output).toMatch(/ID.* test-project-id/);
  });

  it('prints "not set" when the project has no icon', async () => {
    jest.mocked(AppQuery.byIdProfileImageUrlAsync).mockResolvedValue(null);

    expect(await runAndGetOutputAsync()).toMatch(/icon.* not set/);
  });
});
