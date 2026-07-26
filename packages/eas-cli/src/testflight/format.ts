import chalk from 'chalk';

import { TestFlightCrash, TestFlightFeedback, TestFlightSubmission } from './fetch';
import formatFields, { FormatFieldsItem } from '../utils/formatFields';
import { fromNow } from '../utils/date';

function formatCreatedDate(createdDate: string): string {
  const date = new Date(createdDate);
  if (isNaN(date.getTime())) {
    return createdDate;
  }
  return `${date.toLocaleString()} (${fromNow(date)} ago)`;
}

function formatDevice(submission: TestFlightSubmission): string {
  return [submission.deviceModel, `iOS ${submission.osVersion}`].join(', ');
}

function formatTester(submission: TestFlightSubmission): string | null {
  if (submission.testerName && submission.testerEmail) {
    return `${submission.testerName} <${submission.testerEmail}>`;
  }
  return submission.testerName ?? submission.testerEmail ?? null;
}

function formatBytes(bytes: number): string {
  const gigabytes = bytes / 1024 ** 3;
  if (gigabytes >= 1) {
    return `${gigabytes.toFixed(1)} GB`;
  }
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function formatDeviceState(submission: TestFlightSubmission): string | null {
  const parts: string[] = [];
  if (submission.batteryPercentage !== null) {
    parts.push(`battery ${submission.batteryPercentage}%`);
  }
  if (submission.diskBytesAvailable !== null && submission.diskBytesTotal !== null) {
    parts.push(
      `disk ${formatBytes(submission.diskBytesAvailable)} free of ${formatBytes(
        submission.diskBytesTotal
      )}`
    );
  }
  if (submission.connectionType) {
    parts.push(submission.connectionType.toLowerCase().replace('_', ' '));
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Indent every line of a possibly multi-line value so it lines up under its label. */
function indentValue(value: string, indent: number): string {
  return value.split('\n').join(`\n${' '.repeat(indent)}`);
}

function commonFields(submission: TestFlightSubmission): FormatFieldsItem[] {
  const tester = formatTester(submission);
  const deviceState = formatDeviceState(submission);
  return [
    { label: 'Submitted', value: formatCreatedDate(submission.createdDate) },
    ...(submission.buildVersion ? [{ label: 'Build', value: submission.buildVersion }] : []),
    { label: 'Device', value: formatDevice(submission) },
    ...(tester ? [{ label: 'Tester', value: tester }] : []),
    ...(submission.locale ? [{ label: 'Locale', value: submission.locale }] : []),
    ...(deviceState ? [{ label: 'State', value: deviceState }] : []),
  ];
}

function formatBlock(heading: string, fields: FormatFieldsItem[]): string {
  // `formatFields` pads labels to the widest one, so multi-line values must be indented by that
  // width plus the two spaces it puts between label and value.
  const labelWidth = Math.max(...fields.map(field => field.label.length)) + 2;
  return [
    chalk.bold(heading),
    formatFields(fields.map(field => ({ ...field, value: indentValue(field.value, labelWidth) }))),
  ].join('\n');
}

/** Prefix list entries with their absolute position, so `--offset` numbering stays meaningful. */
function heading(kind: string, id: string, position?: number): string {
  return position === undefined ? `${kind} ${id}` : `${position}. ${kind} ${id}`;
}

export function formatTestFlightFeedback(feedback: TestFlightFeedback, position?: number): string {
  const screenshots = feedback.screenshots.map(
    screenshot => `${screenshot.url} (${screenshot.width}x${screenshot.height})`
  );

  return formatBlock(heading('Feedback', feedback.id, position), [
    ...commonFields(feedback),
    { label: 'Comment', value: feedback.comment ?? chalk.dim('(no comment)') },
    ...(screenshots.length > 0 ? [{ label: 'Screenshots', value: screenshots.join('\n') }] : []),
  ]);
}

export function formatTestFlightCrash(crash: TestFlightCrash, position?: number): string {
  return formatBlock(heading('Crash', crash.id, position), [
    ...commonFields(crash),
    ...(crash.comment ? [{ label: 'Comment', value: crash.comment }] : []),
  ]);
}

export function formatTestFlightCrashDetails(
  crash: TestFlightCrash,
  logText: string | null,
  logError: string | null = null
): string {
  const details = formatBlock(heading('Crash', crash.id), [
    ...commonFields(crash),
    ...(crash.architecture ? [{ label: 'Arch', value: crash.architecture }] : []),
    ...(crash.appUptimeInMilliseconds !== null
      ? [{ label: 'Uptime', value: `${(crash.appUptimeInMilliseconds / 1000).toFixed(1)}s` }]
      : []),
    ...(crash.comment ? [{ label: 'Comment', value: crash.comment }] : []),
  ]);

  let log: string;
  if (logText !== null) {
    log = logText;
  } else if (logError !== null) {
    log = chalk.yellow(`Could not fetch the crash log: ${logError}`);
  } else {
    log = chalk.dim('No crash log is available for this submission yet.');
  }

  return [details, '', chalk.bold('Crash log'), log].join('\n');
}
