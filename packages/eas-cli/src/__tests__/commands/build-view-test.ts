import { getErrorAsync, mockCommandContext, mockProjectId, mockTestCommand } from './utils';
import BuildView from '../../commands/build/view';
import { BuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { streamBuildLogsAsync } from '../../build/logs';
import Log from '../../log';

jest.mock('../../graphql/queries/BuildQuery');
jest.mock('../../project/projectUtils');
jest.mock('../../build/logs');
jest.mock('../../build/utils/formatBuild', () => ({
  formatGraphQLBuild: jest.fn(() => 'formatted build'),
}));
jest.mock('../../log');
jest.mock('../../utils/json');
jest.mock('../../ora', () => ({
  ora: () => ({
    start(text?: string) {
      return {
        text,
        succeed: jest.fn(),
        fail: jest.fn(),
      };
    },
  }),
}));

describe(BuildView, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('streams logs when --stream-logs is provided', async () => {
    const ctx = mockCommandContext(BuildView, { projectId: mockProjectId }) as any;
    ctx.loggedIn.graphqlClient = {};

    const build = {
      id: 'build-id',
      status: BuildStatus.InProgress,
      logFiles: ['https://example.com/logs/build.txt'],
    };

    jest.mocked(getDisplayNameForProjectIdAsync).mockResolvedValue('Example app');
    jest.mocked(BuildQuery.byIdAsync).mockResolvedValue(build as any);

    const cmd = mockTestCommand(BuildView, ['build-id', '--stream-logs'], ctx);
    await cmd.run();

    expect(BuildQuery.byIdAsync).toHaveBeenCalledWith(ctx.loggedIn.graphqlClient, 'build-id');
    expect(streamBuildLogsAsync).toHaveBeenCalledWith(ctx.loggedIn.graphqlClient, build);
    expect(Log.log).toHaveBeenCalledWith('\nformatted build');
  });

  test('fails when --stream-logs is combined with --json', async () => {
    const ctx = mockCommandContext(BuildView, { projectId: mockProjectId }) as any;
    ctx.loggedIn.graphqlClient = {};

    const cmd = mockTestCommand(BuildView, ['build-id', '--stream-logs', '--json'], ctx);
    const error = await getErrorAsync(() => cmd.run());

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('--stream-logs cannot be used with --json');
    expect(BuildQuery.byIdAsync).not.toHaveBeenCalled();
    expect(streamBuildLogsAsync).not.toHaveBeenCalled();
  });
});
