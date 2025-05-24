import {
  getMockAppWorkflowRunsFragment,
  getMockEmptyAppWorkflowRunsFragment,
  mockCommandContext,
  mockProjectId,
  mockTestCommand,
} from './utils';
import ProjectWorkflowRunList from '../../commands/workflow-run/list';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log from '../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

jest.mock('../../build/android/version');
jest.mock('../../build/ios/version');
jest.mock('../../project/applicationIdentifier');
jest.mock('../../graphql/queries/AppVersionQuery');
jest.mock('../../graphql/queries/AppQuery');
jest.mock('../../graphql/mutations/AppVersionMutation');
jest.mock('../../project/workflow');
jest.mock('../../project/android/gradleUtils');
jest.mock('../../project/ios/target');
jest.mock('../../project/ios/scheme');
jest.mock('fs');
jest.mock('../../log');
jest.mock('../../prompts');
jest.mock('../../utils/json');

describe(ProjectWorkflowRunList, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  test('list workflow runs with default params', async () => {
    const ctx = mockCommandContext(ProjectWorkflowRunList, {
      projectId: mockProjectId,
    });
    jest
      .mocked(AppQuery.byIdWorkflowRunsAsync)
      .mockResolvedValue(getMockEmptyAppWorkflowRunsFragment());
    const cmd = mockTestCommand(ProjectWorkflowRunList, [], ctx);
    await cmd.run();
    expect(AppQuery.byIdWorkflowRunsAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      10
    );
    expect(enableJsonOutput).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).not.toHaveBeenCalled();
  });
  test('list workflow runs with custom limit', async () => {
    const ctx = mockCommandContext(ProjectWorkflowRunList, {
      projectId: mockProjectId,
    });
    jest
      .mocked(AppQuery.byIdWorkflowRunsAsync)
      .mockResolvedValue(getMockEmptyAppWorkflowRunsFragment());
    const cmd = mockTestCommand(ProjectWorkflowRunList, ['--limit', '100'], ctx);
    await cmd.run();
    expect(AppQuery.byIdWorkflowRunsAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      100
    );
    expect(enableJsonOutput).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).not.toHaveBeenCalled();
  });
  test('list workflow runs and select failures, get json output', async () => {
    const ctx = mockCommandContext(ProjectWorkflowRunList, {
      projectId: mockProjectId,
    });
    jest
      .mocked(AppQuery.byIdWorkflowRunsAsync)
      .mockResolvedValue(getMockAppWorkflowRunsFragment({ successes: 2, failures: 1 }));
    const cmd = mockTestCommand(ProjectWorkflowRunList, ['--status', 'FAILURE', '--json'], ctx);
    await cmd.run();
    expect(AppQuery.byIdWorkflowRunsAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      10
    );
    expect(Log.log).toHaveBeenLastCalledWith(`[
  {
    "id": "failure-0",
    "status": "FAILURE",
    "createdAt": "2022-01-01T00:00:00.000Z",
    "workflowId": "build",
    "workflowName": "build"
  }
]`);
  });
});
