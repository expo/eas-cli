import {
  getMockEmptyWorkflowRunsFragment,
  getMockWorkflowRunsFragment,
  mockCommandContext,
  mockProjectId,
  mockTestCommand,
} from './utils';
import WorkflowRunList from '../../commands/workflow/runs';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import { WorkflowRunStatus } from '../../graphql/generated';

jest.mock('../../build/android/version');
jest.mock('../../build/ios/version');
jest.mock('../../project/applicationIdentifier');
jest.mock('../../graphql/queries/AppVersionQuery');
jest.mock('../../graphql/queries/AppQuery');
jest.mock('../../graphql/queries/WorkflowRunQuery');
jest.mock('../../graphql/mutations/AppVersionMutation');
jest.mock('../../project/workflow');
jest.mock('../../project/android/gradleUtils');
jest.mock('../../project/ios/target');
jest.mock('../../project/ios/scheme');
jest.mock('fs');
jest.mock('../../log');
jest.mock('../../prompts');
jest.mock('../../utils/json');

describe(WorkflowRunList, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  test('list workflow runs with default params', async () => {
    const ctx = mockCommandContext(WorkflowRunList, {
      projectId: mockProjectId,
    });
    jest
      .mocked(AppQuery.byIdWorkflowRunsFilteredByStatusAsync)
      .mockResolvedValue(getMockEmptyWorkflowRunsFragment());
    const cmd = mockTestCommand(WorkflowRunList, [], ctx);
    await cmd.run();
    expect(AppQuery.byIdWorkflowRunsFilteredByStatusAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      undefined,
      10
    );
    expect(enableJsonOutput).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).not.toHaveBeenCalled();
  });
  test('list workflow runs with custom limit', async () => {
    const ctx = mockCommandContext(WorkflowRunList, {
      projectId: mockProjectId,
    });
    jest
      .mocked(AppQuery.byIdWorkflowRunsFilteredByStatusAsync)
      .mockResolvedValue(getMockEmptyWorkflowRunsFragment());
    const cmd = mockTestCommand(WorkflowRunList, ['--limit', '100'], ctx);
    await cmd.run();
    expect(AppQuery.byIdWorkflowRunsFilteredByStatusAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      undefined,
      100
    );
    expect(enableJsonOutput).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).not.toHaveBeenCalled();
  });
  test('list workflow runs with specific filename', async () => {
    const ctx = mockCommandContext(WorkflowRunList, {
      projectId: mockProjectId,
    });
    jest.mocked(WorkflowRunQuery.byAppIdFileNameAndStatusAsync).mockResolvedValue([
      {
        id: 'build',
        status: WorkflowRunStatus.Success,
        createdAt: '2022-01-01T00:00:00.000Z',
        updatedAt: '2022-01-01T00:00:00.000Z',
        gitCommitHash: '1234567890',
        gitCommitMessage: 'commit message',
        workflow: {
          id: 'build',
          name: 'build',
          fileName: 'build.yml',
        },
      },
    ]);
    const cmd = mockTestCommand(WorkflowRunList, ['--workflow', 'build.yml'], ctx);
    await cmd.run();
    expect(WorkflowRunQuery.byAppIdFileNameAndStatusAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'build.yml',
      undefined,
      10
    );
    expect(enableJsonOutput).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).not.toHaveBeenCalled();
  });
  test('list only workflow runs with status FAILURE, get json output', async () => {
    const ctx = mockCommandContext(WorkflowRunList, {
      projectId: mockProjectId,
    });
    jest
      .mocked(AppQuery.byIdWorkflowRunsFilteredByStatusAsync)
      .mockResolvedValue(getMockWorkflowRunsFragment({ failures: 1 }));
    const cmd = mockTestCommand(WorkflowRunList, ['--status', 'FAILURE', '--json'], ctx);
    await cmd.run();
    expect(AppQuery.byIdWorkflowRunsFilteredByStatusAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      WorkflowRunStatus.Failure,
      10
    );
    expect(printJsonOnlyOutput).toHaveBeenCalledWith([
      {
        id: 'failure-0',
        status: 'FAILURE',
        gitCommitHash: '1234567890',
        gitCommitMessage: 'commit message',
        startedAt: '2022-01-01T00:00:00.000Z',
        finishedAt: '2022-01-01T00:00:00.000Z',
        workflowId: 'build',
        workflowName: 'build',
        workflowFileName: 'build.yml',
      },
    ]);
  });
  test('list only workflow runs with specific filename and status FAILURE, get json output', async () => {
    const ctx = mockCommandContext(WorkflowRunList, {
      projectId: mockProjectId,
    });
    jest.mocked(WorkflowRunQuery.byAppIdFileNameAndStatusAsync).mockResolvedValue([
      {
        id: 'build1',
        status: WorkflowRunStatus.Failure,
        createdAt: '2022-01-01T00:00:00.000Z',
        updatedAt: '2022-01-01T00:00:00.000Z',
        gitCommitHash: '1234567890',
        gitCommitMessage: 'commit message',
        workflow: {
          id: 'build',
          name: 'build',
          fileName: 'build.yml',
        },
      },
    ]);
    const cmd = mockTestCommand(
      WorkflowRunList,
      ['--workflow', 'build.yml', '--status', 'FAILURE', '--json'],
      ctx
    );
    await cmd.run();
    expect(WorkflowRunQuery.byAppIdFileNameAndStatusAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'build.yml',
      WorkflowRunStatus.Failure,
      10
    );
    expect(printJsonOnlyOutput).toHaveBeenCalledWith([
      {
        id: 'build1',
        status: 'FAILURE',
        gitCommitHash: '1234567890',
        gitCommitMessage: 'commit message',
        startedAt: '2022-01-01T00:00:00.000Z',
        finishedAt: '2022-01-01T00:00:00.000Z',
        workflowId: 'build',
        workflowName: 'build',
        workflowFileName: 'build.yml',
      },
    ]);
  });
});
