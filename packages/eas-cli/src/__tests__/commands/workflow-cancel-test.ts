import {
  getMockWorkflowRunFragment,
  mockCommandContext,
  mockProjectId,
  mockTestCommand,
} from './utils';
import WorkflowRunCancel from '../../commands/workflow/cancel';
import { WorkflowRunStatus } from '../../graphql/generated';
import { WorkflowRunMutation } from '../../graphql/mutations/WorkflowRunMutation';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { promptAsync } from '../../prompts';

jest.mock('../../graphql/queries/AppQuery');
jest.mock('../../graphql/mutations/WorkflowRunMutation');
jest.mock('../../log');
jest.mock('../../prompts');

describe(WorkflowRunCancel, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('prompts with in-progress and queued runs and cancels the selected ones', async () => {
    const ctx = mockCommandContext(WorkflowRunCancel, {
      projectId: mockProjectId,
    });
    const inProgressRun = getMockWorkflowRunFragment(WorkflowRunStatus.InProgress);
    const waitingRun = getMockWorkflowRunFragment(WorkflowRunStatus.Waiting);
    jest
      .mocked(AppQuery.byIdWorkflowRunsFilteredByStatusAsync)
      .mockImplementation(async (_graphqlClient, _appId, status) =>
        status === WorkflowRunStatus.InProgress ? [inProgressRun] : [waitingRun]
      );
    jest.mocked(promptAsync).mockResolvedValueOnce({ selectedRuns: [waitingRun.id] });

    const cmd = mockTestCommand(WorkflowRunCancel, [], ctx);
    await cmd.run();

    expect(AppQuery.byIdWorkflowRunsFilteredByStatusAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      WorkflowRunStatus.InProgress,
      50
    );
    expect(AppQuery.byIdWorkflowRunsFilteredByStatusAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      WorkflowRunStatus.Waiting,
      50
    );
    const promptCall = jest.mocked(promptAsync).mock.calls[0][0] as any;
    expect(promptCall.choices.map((choice: any) => choice.value)).toEqual([
      inProgressRun.id,
      waitingRun.id,
    ]);
    expect(WorkflowRunMutation.cancelWorkflowRunAsync).toHaveBeenCalledTimes(1);
    expect(WorkflowRunMutation.cancelWorkflowRunAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      { workflowRunId: waitingRun.id }
    );
  });

  test('throws in non-interactive mode when no run IDs are given', async () => {
    const ctx = mockCommandContext(WorkflowRunCancel, {
      projectId: mockProjectId,
    });
    const cmd = mockTestCommand(WorkflowRunCancel, ['--non-interactive'], ctx);
    await expect(cmd.run()).rejects.toThrow(
      'Must supply workflow run IDs as arguments when in non-interactive mode'
    );
    expect(promptAsync).not.toHaveBeenCalled();
  });

  test('cancels the given run IDs without prompting in non-interactive mode', async () => {
    const ctx = mockCommandContext(WorkflowRunCancel, {
      projectId: mockProjectId,
    });
    const cmd = mockTestCommand(WorkflowRunCancel, ['--non-interactive', 'run-id-1'], ctx);
    await cmd.run();
    expect(AppQuery.byIdWorkflowRunsFilteredByStatusAsync).not.toHaveBeenCalled();
    expect(promptAsync).not.toHaveBeenCalled();
    expect(WorkflowRunMutation.cancelWorkflowRunAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      { workflowRunId: 'run-id-1' }
    );
  });
});
