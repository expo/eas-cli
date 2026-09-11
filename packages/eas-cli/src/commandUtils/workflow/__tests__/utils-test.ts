import { getMockWorkflowRunWithJobsFragment } from '../../../__tests__/commands/utils';
import { WorkflowJobStatus } from '../../../graphql/generated';
import { groupLogLinesIntoSteps, parseLogLines } from '../logs/parseLogs';
import { WorkflowLogs, WorkflowRawLogLine } from '../types';
import { formatActiveWorkflowRun, formatFailedWorkflowRun } from '../utils';

function jobWithLogs(
  logLines: WorkflowRawLogLine[],
  status: WorkflowJobStatus = WorkflowJobStatus.InProgress
): {
  job: ReturnType<typeof getMockWorkflowRunWithJobsFragment>['jobs'][number];
  logs: WorkflowLogs;
} {
  return {
    job: { ...getMockWorkflowRunWithJobsFragment().jobs[0], status },
    logs: groupLogLinesIntoSteps(logLines),
  };
}

function stepLines(buildStepId: string, count: number): WorkflowRawLogLine[] {
  return Array.from({ length: count }, (_, index) => ({ buildStepId, msg: `line${index}` }));
}

describe(formatActiveWorkflowRun, () => {
  test('shows the display name for the current step while keying logs by step id', () => {
    const output = formatActiveWorkflowRun([
      jobWithLogs(
        parseLogLines(
          [
            '{"buildStepId":"step-id-1","buildStepDisplayName":"Install dependencies","time":"2022-01-01T00:00:00.000Z","msg":"npm ci"}',
            '{"buildStepId":"step-id-1","buildStepDisplayName":"Install dependencies","marker":"end-step","result":"success","time":"2022-01-01T00:00:01.000Z","msg":"done"}',
          ].join('\n')
        ).logLines
      ),
    ]);

    expect(output).toContain('Current step');
    expect(output).toContain('Install dependencies');
    expect(output).not.toContain('step-id-1');
  });

  test('shows exactly maxLogLines trailing lines of the current step', () => {
    const output = formatActiveWorkflowRun([jobWithLogs(stepLines('step-id-1', 10))], 5);

    expect(output).toContain('line5');
    expect(output).toContain('line9');
    expect(output).not.toContain('line4');
  });

  test('keeps five trailing lines by default', () => {
    const output = formatActiveWorkflowRun([jobWithLogs(stepLines('step-id-1', 10))]);

    expect(output).toContain('line5');
    expect(output).toContain('line9');
    expect(output).not.toContain('line4');
  });

  test('reports the last step as the current one', () => {
    const output = formatActiveWorkflowRun([
      jobWithLogs([
        { buildStepId: 'install', buildStepDisplayName: 'Install', msg: 'installing' },
        { buildStepId: 'build', buildStepDisplayName: 'Build', msg: 'compiling' },
      ]),
    ]);

    expect(output).toContain('Build');
    expect(output).not.toContain('Install');
  });

  test('passes over a trailing skipped step', () => {
    const output = formatActiveWorkflowRun([
      jobWithLogs([
        { buildStepId: 'install', buildStepDisplayName: 'Install', msg: 'installing' },
        {
          buildStepId: 'build',
          buildStepDisplayName: 'Build',
          msg: 'skipping',
          marker: 'end-step',
          result: 'skipped',
        },
      ]),
    ]);

    expect(output).toContain('Install');
    expect(output).not.toContain('Build');
  });

  test('reports a step that has not ended yet', () => {
    const output = formatActiveWorkflowRun([
      jobWithLogs([
        {
          buildStepId: 'install',
          buildStepDisplayName: 'Install',
          msg: 'installed',
          marker: 'end-step',
          result: 'success',
        },
        { buildStepId: 'build', buildStepDisplayName: 'Build', msg: 'compiling' },
      ]),
    ]);

    expect(output).toContain('Build');
  });

  test('omits the current step when the job has no steps yet', () => {
    const output = formatActiveWorkflowRun([jobWithLogs([])]);

    expect(output).not.toContain('Current step');
    expect(output).not.toContain('Current logs');
  });

  test('omits the current step for a job that is not in progress', () => {
    const output = formatActiveWorkflowRun([
      jobWithLogs(stepLines('step-id-1', 3), WorkflowJobStatus.Success),
    ]);

    expect(output).not.toContain('Current step');
    expect(output).not.toContain('line0');
  });
});

describe(formatFailedWorkflowRun, () => {
  test('prints every line of the failed step when there is no limit', () => {
    const output = formatFailedWorkflowRun([
      jobWithLogs(
        [
          ...stepLines('build', 8),
          { buildStepId: 'build', msg: 'it failed', marker: 'end-step', result: 'fail' },
        ],
        WorkflowJobStatus.Failure
      ),
    ]);

    expect(output).toContain('line0');
    expect(output).toContain('line7');
  });
});
