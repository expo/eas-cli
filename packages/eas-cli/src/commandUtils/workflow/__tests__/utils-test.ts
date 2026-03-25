import { getMockWorkflowRunWithJobsFragment } from '../../../__tests__/commands/utils';
import { fetchRawLogsForCustomJobAsync } from '../fetchLogs';
import { infoForActiveWorkflowRunAsync } from '../utils';
import { WorkflowJobStatus } from '../../../graphql/generated';

jest.mock('../fetchLogs');

describe('workflow utils', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('shows the display name for the current step while keying logs by step id', async () => {
    const workflowRun = getMockWorkflowRunWithJobsFragment();
    workflowRun.jobs = workflowRun.jobs.map(job => ({
      ...job,
      status: WorkflowJobStatus.InProgress,
    }));

    jest
      .mocked(fetchRawLogsForCustomJobAsync)
      .mockResolvedValue(
        [
          '{"buildStepId":"step-id-1","buildStepDisplayName":"Install dependencies","time":"2022-01-01T00:00:00.000Z","msg":"npm ci"}',
          '{"buildStepId":"step-id-1","buildStepDisplayName":"Install dependencies","marker":"end-step","result":"success","time":"2022-01-01T00:00:01.000Z","msg":"done"}',
        ].join('\n')
      );

    const output = await infoForActiveWorkflowRunAsync({} as any, workflowRun);

    expect(output).toContain('Current step');
    expect(output).toContain('Install dependencies');
    expect(output).not.toContain('step-id-1');
  });
});
