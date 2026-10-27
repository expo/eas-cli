import { GradleProfileTask, formatGradleProfileReport } from '../gradleProfile';

describe(formatGradleProfileReport, () => {
  it('does not expand the table for long task names', () => {
    const tasks: GradleProfileTask[] = [
      { path: ':app', durationMs: 10_000, result: '(total)' },
      {
        path: ':app:aVeryLongGradleTaskNameThatWouldOtherwiseMakeTheTableTooWide',
        durationMs: 10_000,
        result: 'executed',
      },
    ];

    const report = formatGradleProfileReport(tasks);
    const tableLines = report.split('\n').filter(line => line.startsWith('│'));

    expect(tableLines).toHaveLength(4);
    expect(new Set(tableLines.map(line => line.length))).toEqual(new Set([112]));
    expect(report).toContain('  └─ aVeryLongGradleTask…wiseMakeTheTableTooWide');
  });

  it('caps the task column for long module names', () => {
    const modulePath = ':aVeryLongGradleModuleNameThatWouldOtherwiseMakeTheTableTooWide';
    const tasks: GradleProfileTask[] = [
      { path: modulePath, durationMs: 10_000, result: '(total)' },
      { path: `${modulePath}:compile`, durationMs: 10_000, result: 'executed' },
    ];

    const report = formatGradleProfileReport(tasks);
    const tableLines = report.split('\n').filter(line => line.startsWith('│'));

    expect(new Set(tableLines.map(line => line.length))).toEqual(new Set([112]));
    expect(report).toContain(':aVeryLongGradleModuleNa…wiseMakeTheTableTooWide');
  });
});
