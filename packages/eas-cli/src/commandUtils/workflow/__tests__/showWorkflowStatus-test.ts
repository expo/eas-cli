import { getMockWorkflowRunWithJobsFragment } from '../../../__tests__/commands/utils';
import { WorkflowJobStatus, WorkflowRunStatus } from '../../../graphql/generated';
import { WorkflowRunQuery } from '../../../graphql/queries/WorkflowRunQuery';
import { ora } from '../../../ora';
import { showWorkflowStatusAsync } from '../utils';

jest.mock('../../../graphql/queries/WorkflowRunQuery');
jest.mock('../../../log');
jest.mock('../../../utils/promise', () => ({ sleepAsync: jest.fn() }));
jest.mock('../../../utils/centrifuge', () => ({ createRealtimeLogsClient: jest.fn() }));
jest.mock('../../logs/watcher', () => ({
  LogsWatcher: jest.fn().mockImplementation(() => ({
    syncAsync: jest.fn(
      async () => new Map([['job1', { markCompleted: jest.fn(), getLogs: () => new Map() }]])
    ),
    close: jest.fn(),
  })),
}));
jest.mock('../../../ora', () => ({
  ...jest.requireActual('../../../ora'),
  ora: jest.fn(),
}));

describe(showWorkflowStatusAsync, () => {
  it('renders the final job statuses when the run succeeds', async () => {
    const spinner: any = { text: '', prefixText: '', isSpinning: true };
    spinner.start = jest.fn(() => spinner);
    spinner.succeed = jest.fn(() => {
      spinner.persistedText = spinner.text;
    });
    jest.mocked(ora).mockReturnValue(spinner);

    const workflowRun = getMockWorkflowRunWithJobsFragment();
    const withJobs = (
      runStatus: WorkflowRunStatus,
      jobStatus: WorkflowJobStatus
    ): typeof workflowRun => ({
      ...workflowRun,
      status: runStatus,
      jobs: [{ ...workflowRun.jobs[0], status: jobStatus }],
    });
    jest
      .mocked(WorkflowRunQuery.withJobsByIdAsync)
      .mockResolvedValueOnce(withJobs(WorkflowRunStatus.InProgress, WorkflowJobStatus.InProgress))
      .mockResolvedValueOnce(withJobs(WorkflowRunStatus.Success, WorkflowJobStatus.Success));

    await showWorkflowStatusAsync({} as any, { workflowRunId: 'run-1', spinnerUsesStdErr: false });

    expect(spinner.succeed).toHaveBeenCalled();
    expect(spinner.persistedText).toContain('Completed successfully');
    expect(spinner.persistedText).not.toContain('In progress');
  });
});
