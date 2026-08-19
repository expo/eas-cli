import { getMockWorkflowRunWithJobsFragment } from '../../../__tests__/commands/utils';
import { WorkflowJobStatus } from '../../../graphql/generated';
import { groupLogLinesIntoSteps, parseLogLines } from '../logs/parseLogs';
import { formatActiveWorkflowRun } from '../utils';

function inProgressJobWithLogs(rawLogs: string): {
  job: ReturnType<typeof getMockWorkflowRunWithJobsFragment>['jobs'][number];
  logs: ReturnType<typeof groupLogLinesIntoSteps>;
} {
  return {
    job: {
      ...getMockWorkflowRunWithJobsFragment().jobs[0],
      status: WorkflowJobStatus.InProgress,
    },
    logs: groupLogLinesIntoSteps(parseLogLines(rawLogs).logLines),
  };
}

describe(formatActiveWorkflowRun, () => {
  test('shows the display name for the current step while keying logs by step id', () => {
    const output = formatActiveWorkflowRun([
      inProgressJobWithLogs(
        [
          '{"buildStepId":"step-id-1","buildStepDisplayName":"Install dependencies","time":"2022-01-01T00:00:00.000Z","msg":"npm ci"}',
          '{"buildStepId":"step-id-1","buildStepDisplayName":"Install dependencies","marker":"end-step","result":"success","time":"2022-01-01T00:00:01.000Z","msg":"done"}',
        ].join('\n')
      ),
    ]);

    expect(output).toContain('Current step');
    expect(output).toContain('Install dependencies');
    expect(output).not.toContain('step-id-1');
  });

  test('shows exactly maxLogLines trailing lines of the current step', () => {
    const output = formatActiveWorkflowRun(
      [
        inProgressJobWithLogs(
          Array.from({ length: 10 }, (_, index) =>
            JSON.stringify({
              buildStepId: 'step-id-1',
              buildStepDisplayName: 'Install dependencies',
              time: '2022-01-01T00:00:00.000Z',
              msg: `line${index}`,
            })
          ).join('\n')
        ),
      ],
      5
    );

    expect(output).toContain('line5');
    expect(output).toContain('line9');
    expect(output).not.toContain('line4');
  });
});
