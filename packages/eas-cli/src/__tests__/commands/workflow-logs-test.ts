import {
  getMockEmptyWorkflowRunsFragment,
  getMockWorkflowJobFragment,
  getMockWorkflowRunWithJobsFragment,
  getMockWorkflowRunsFragment,
  mockCommandContext,
  mockProjectId,
  mockTestCommand,
} from './utils';
import { fetchRawLogsForJobAsync } from '../../commandUtils/workflow/fetchLogs';
import WorkflowLogView from '../../commands/workflow/logs';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { WorkflowJobQuery } from '../../graphql/queries/WorkflowJobQuery';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import Log from '../../log';
import { promptAsync } from '../../prompts';

jest.mock('../../build/android/version');
jest.mock('../../build/ios/version');
jest.mock('../../project/applicationIdentifier');
jest.mock('../../graphql/queries/AppVersionQuery');
jest.mock('../../graphql/queries/AppQuery');
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
    jest.mocked(WorkflowJobQuery.byIdAsync).mockResolvedValue(getMockWorkflowJobFragment());
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
    jest.mocked(fetchRawLogsForJobAsync).mockResolvedValue(null);
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
    jest
      .mocked(fetchRawLogsForJobAsync)
      .mockResolvedValue(
        '{"result":"test","marker":"test","buildStepDisplayName":"step1","buildStepInternalId":"step1","time":"2022-01-01T00:00:00.000Z","msg":"test"}'
      );
    await cmd.run();
    expect(AppQuery.byIdWorkflowRunsFilteredByStatusAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      undefined,
      20
    );
    expect(promptAsync).toHaveBeenCalledTimes(3);
    expect(Log.error).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith('  2022-01-01T00:00:00.000Z test');
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
