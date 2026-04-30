import {
  getMockEmptyWorkflowRunsFragment,
  getMockWorkflowCustomJobFragment,
  getMockWorkflowRunWithBuildJobsFragment,
  getMockWorkflowRunWithJobsFragment,
  getMockWorkflowRunsFragment,
  mockCommandContext,
  mockProjectId,
  mockTestCommand,
} from './utils';
import {
  fetchRawLogsForBuildJobAsync,
  fetchRawLogsForCustomJobAsync,
} from '../../commandUtils/workflow/fetchLogs';
import WorkflowLogView from '../../commands/workflow/logs';
import { AppPlatform, BuildPriority, BuildStatus } from '../../graphql/generated';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { WorkflowJobQuery } from '../../graphql/queries/WorkflowJobQuery';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import Log from '../../log';
import { promptAsync } from '../../prompts';

jest.mock('../../build/android/version');
jest.mock('../../build/ios/version');
jest.mock('../../project/applicationIdentifier');
jest.mock('../../graphql/queries/AppVersionQuery');
jest.mock('../../graphql/queries/AppQuery');
jest.mock('../../graphql/queries/BuildQuery');
jest.mock('../../graphql/queries/WorkflowJobQuery');
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
jest.mock('../../commandUtils/workflow/fetchLogs');

describe(WorkflowLogView, () => {
  beforeEach(() => {
    jest.mocked(WorkflowJobQuery.byIdAsync).mockResolvedValue(getMockWorkflowCustomJobFragment());
    jest
      .mocked(WorkflowRunQuery.withJobsByIdAsync)
      .mockResolvedValue(getMockWorkflowRunWithJobsFragment());
  });
  afterEach(() => {
    jest.clearAllMocks();
  });
  test('view logs, passing in no parameters, no runs found', async () => {
    const ctx = mockCommandContext(WorkflowLogView, {
      projectId: mockProjectId,
    });
    const cmd = mockTestCommand(WorkflowLogView, [], ctx);
    jest
      .mocked(AppQuery.byIdWorkflowRunsFilteredByStatusAsync)
      .mockResolvedValue(getMockEmptyWorkflowRunsFragment());
    await cmd.run();
    expect(AppQuery.byIdWorkflowRunsFilteredByStatusAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      undefined,
      20
    );
    expect(Log.error).toHaveBeenCalledWith('No workflow runs found');
  });
  test('view logs, passing in no parameters, runs found, no jobs', async () => {
    const ctx = mockCommandContext(WorkflowLogView, {
      projectId: mockProjectId,
    });
    const cmd = mockTestCommand(WorkflowLogView, [], ctx);
    jest
      .mocked(AppQuery.byIdWorkflowRunsFilteredByStatusAsync)
      .mockResolvedValue(getMockWorkflowRunsFragment({ successes: 1 }));
    jest.mocked(promptAsync).mockResolvedValue({ selectedRun: 'build1' });
    await cmd.run();
    expect(AppQuery.byIdWorkflowRunsFilteredByStatusAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      undefined,
      20
    );
    expect(Log.error).toHaveBeenCalledWith('No job found');
  });
  test('view logs, passing in no parameters, runs found, jobs found, step selected, no logs', async () => {
    const ctx = mockCommandContext(WorkflowLogView, {
      projectId: mockProjectId,
    });
    const cmd = mockTestCommand(WorkflowLogView, [], ctx);
    jest
      .mocked(AppQuery.byIdWorkflowRunsFilteredByStatusAsync)
      .mockResolvedValue(getMockWorkflowRunsFragment({ withJobs: 1 }));
    let promptCalls = 0;
    jest.mocked(promptAsync).mockImplementation(async () => {
      if (promptCalls === 0) {
        promptCalls++;
        return { selectedRun: 'build1' };
      } else if (promptCalls === 1) {
        promptCalls++;
        return { selectedJob: 0 };
      } else {
        return { selectedStep: 'step1' };
      }
    });
    jest.mocked(fetchRawLogsForCustomJobAsync).mockResolvedValue(null);
    await cmd.run();
    expect(AppQuery.byIdWorkflowRunsFilteredByStatusAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      undefined,
      20
    );
    expect(promptAsync).toHaveBeenCalledTimes(2);
    expect(Log.error).toHaveBeenCalledWith('No logs found');
  });
  test('view logs, passing in no parameters, runs found, jobs found, step selected, logs found', async () => {
    const ctx = mockCommandContext(WorkflowLogView, {
      projectId: mockProjectId,
    });
    const cmd = mockTestCommand(WorkflowLogView, [], ctx);
    jest
      .mocked(AppQuery.byIdWorkflowRunsFilteredByStatusAsync)
      .mockResolvedValue(getMockWorkflowRunsFragment({ withJobs: 1 }));
    let promptCalls = 0;
    let stepPrompt: any;
    jest.mocked(promptAsync).mockImplementation(async prompt => {
      if (promptCalls === 0) {
        promptCalls++;
        return { selectedRun: 'build1' };
      } else if (promptCalls === 1) {
        promptCalls++;
        return { selectedJob: 0 };
      } else {
        stepPrompt = prompt;
        return { selectedStep: 'step-id-1' };
      }
    });
    jest
      .mocked(fetchRawLogsForCustomJobAsync)
      .mockResolvedValue(
        '{"result":"success","marker":"end-step","buildStepDisplayName":"Install dependencies","buildStepId":"step-id-1","time":"2022-01-01T00:00:00.000Z","msg":"test"}'
      );
    await cmd.run();
    expect(AppQuery.byIdWorkflowRunsFilteredByStatusAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      undefined,
      20
    );
    expect(promptAsync).toHaveBeenCalledTimes(3);
    expect(stepPrompt.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Install dependencies - success',
          value: 'step-id-1',
        }),
      ])
    );
    expect(Log.error).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith('  2022-01-01T00:00:00.000Z test');
  });
  test('view build logs, passing in no parameters, runs found, jobs found, step selected, logs found', async () => {
    const ctx = mockCommandContext(WorkflowLogView, {
      projectId: mockProjectId,
    });
    const cmd = mockTestCommand(WorkflowLogView, [], ctx);
    jest
      .mocked(AppQuery.byIdWorkflowRunsFilteredByStatusAsync)
      .mockResolvedValue(getMockWorkflowRunsFragment({ withBuildJobs: 1 }));
    jest
      .mocked(WorkflowRunQuery.withJobsByIdAsync)
      .mockResolvedValue(getMockWorkflowRunWithBuildJobsFragment());
    jest.mocked(BuildQuery.byIdAsync).mockResolvedValue({
      id: 'build1',
      status: BuildStatus.Finished,
      priority: BuildPriority.Normal,
      createdAt: '2022-01-01T00:00:00.000Z',
      updatedAt: '2022-01-01T00:00:00.000Z',
      isForIosSimulator: false,
      project: {
        id: mockProjectId,
        __typename: 'App',
        name: 'App',
        slug: 'app',
        ownerAccount: {
          id: 'account-id',
          name: 'account-name',
          __typename: 'Account',
        },
      },
      platform: AppPlatform.Android,
      logFiles: ['https://example.com/log1'],
    });
    let promptCalls = 0;
    let stepPrompt: any;
    jest.mocked(promptAsync).mockImplementation(async prompt => {
      if (promptCalls === 0) {
        promptCalls++;
        return { selectedRun: 'build1' };
      } else if (promptCalls === 1) {
        promptCalls++;
        return { selectedJob: 0 };
      } else {
        stepPrompt = prompt;
        return { selectedStep: 'step-id-1' };
      }
    });
    jest
      .mocked(fetchRawLogsForBuildJobAsync)
      .mockResolvedValue(
        '{"result":"success","marker":"end-step","buildStepDisplayName":"step1","buildStepId":"step-id-1","time":"2022-01-01T00:00:00.000Z","msg":"test"}'
      );
    await cmd.run();
    expect(AppQuery.byIdWorkflowRunsFilteredByStatusAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      undefined,
      20
    );
    expect(promptAsync).toHaveBeenCalledTimes(3);
    expect(stepPrompt.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'step1 - success',
          value: 'step-id-1',
        }),
      ])
    );
    expect(Log.error).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith('  2022-01-01T00:00:00.000Z test');
  });
  test('view logs keeps duplicate display names separated by step id', async () => {
    const ctx = mockCommandContext(WorkflowLogView, {
      projectId: mockProjectId,
    });
    const cmd = mockTestCommand(WorkflowLogView, [], ctx);
    jest
      .mocked(AppQuery.byIdWorkflowRunsFilteredByStatusAsync)
      .mockResolvedValue(getMockWorkflowRunsFragment({ withJobs: 1 }));
    let promptCalls = 0;
    let stepPrompt: any;
    jest.mocked(promptAsync).mockImplementation(async prompt => {
      if (promptCalls === 0) {
        promptCalls++;
        return { selectedRun: 'build1' };
      } else if (promptCalls === 1) {
        promptCalls++;
        return { selectedJob: 0 };
      } else {
        stepPrompt = prompt;
        return { selectedStep: 'step-id-2' };
      }
    });
    jest
      .mocked(fetchRawLogsForCustomJobAsync)
      .mockResolvedValue(
        [
          '{"result":"success","marker":"end-step","buildStepDisplayName":"Install","buildStepId":"step-id-1","time":"2022-01-01T00:00:00.000Z","msg":"first"}',
          '{"result":"fail","marker":"end-step","buildStepDisplayName":"Install","buildStepId":"step-id-2","time":"2022-01-01T00:00:01.000Z","msg":"second"}',
        ].join('\n')
      );

    await cmd.run();

    expect(promptAsync).toHaveBeenCalledTimes(3);
    expect(stepPrompt.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Install - success',
          value: 'step-id-1',
        }),
        expect.objectContaining({
          title: 'Install - fail',
          value: 'step-id-2',
        }),
      ])
    );
    expect(Log.log).toHaveBeenCalledWith('  2022-01-01T00:00:01.000Z second');
  });
  test('view logs for a workflow job, passing in a job ID, all steps', async () => {
    const ctx = mockCommandContext(WorkflowLogView, {
      projectId: mockProjectId,
    });
    const cmd = mockTestCommand(WorkflowLogView, ['job1', '--all-steps'], ctx);
    await cmd.run();
    expect(WorkflowJobQuery.byIdAsync).toHaveBeenCalledWith(ctx.loggedIn.graphqlClient, 'job1', {
      useCache: false,
    });
  });
  test('view logs for a workflow job, passing in a run ID', async () => {
    const ctx = mockCommandContext(WorkflowLogView, {
      projectId: mockProjectId,
    });
    jest.mocked(promptAsync).mockResolvedValue({ selectedJob: 'job1' });
    jest.mocked(WorkflowJobQuery.byIdAsync).mockRejectedValue(new Error('Job not found'));
    const cmd = mockTestCommand(WorkflowLogView, ['build1', '--all-steps'], ctx);
    await cmd.run();
    expect(WorkflowRunQuery.withJobsByIdAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      'build1',
      {
        useCache: false,
      }
    );
  });
  test('view logs for a workflow job, passing in a run ID, non-interactive', async () => {
    const ctx = mockCommandContext(WorkflowLogView, {
      projectId: mockProjectId,
    });
    jest.mocked(promptAsync).mockResolvedValue({ selectedJob: 'job1' });
    jest.mocked(WorkflowJobQuery.byIdAsync).mockRejectedValue(new Error('Job not found'));
    const cmd = mockTestCommand(WorkflowLogView, ['build1', '--non-interactive'], ctx);
    try {
      await cmd.run();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toEqual('No workflow job found that matched the provided ID');
    }
  });
});
