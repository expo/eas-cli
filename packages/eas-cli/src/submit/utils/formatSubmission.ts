import chalk from 'chalk';

import { getSubmissionDetailsUrl } from './urls';
import {
  AppPlatform,
  SubmissionStatus,
  SubmissionWithSubmittedBuildFragment,
} from '../../graphql/generated';
import { link } from '../../log';
import { appPlatformDisplayNames } from '../../platform';
import formatFields from '../../utils/formatFields';
import { sanitizeTerminalText } from '../../utils/terminalText';

// Submission and build fields carry project-controlled text (versions, profiles, error
// messages); strip control characters so a crafted value cannot spoof terminal output.
const sanitize = (value: string | null | undefined): string | null | undefined =>
  value == null ? value : sanitizeTerminalText(value);

export function formatGraphQLSubmission(submission: SubmissionWithSubmittedBuildFragment): string {
  const { submittedBuild } = submission;
  const fields: { label: string; value?: string | null }[] = [
    { label: 'ID', value: submission.id },
    {
      label: 'Platform',
      value: appPlatformDisplayNames[submission.platform],
    },
    {
      label: 'Status',
      get value() {
        switch (submission.status) {
          case SubmissionStatus.AwaitingBuild:
            return chalk.blue('awaiting build');
          case SubmissionStatus.InQueue:
            return chalk.blue('in queue');
          case SubmissionStatus.InProgress:
            return chalk.blue('in progress');
          case SubmissionStatus.Finished:
            return chalk.green('finished');
          case SubmissionStatus.Errored:
            return chalk.red('errored');
          case SubmissionStatus.Canceled:
            return chalk.gray('canceled');
          default:
            return 'unknown';
        }
      },
    },
    ...(submission.platform === AppPlatform.Android
      ? [
          { label: 'Track', value: sanitize(submission.androidConfig?.track)?.toLowerCase() },
          {
            label: 'Release Status',
            value: submission.androidConfig?.releaseStatus?.toLowerCase(),
          },
        ]
      : [{ label: 'ASC App ID', value: sanitize(submission.iosConfig?.ascAppIdentifier) }]),
    { label: 'Build ID', value: submittedBuild?.id },
    { label: 'Build Profile', value: sanitize(submittedBuild?.buildProfile) },
    { label: 'App Version', value: sanitize(submittedBuild?.appVersion) },
    {
      label: submission.platform === AppPlatform.Android ? 'Version code' : 'Build number',
      value: sanitize(submittedBuild?.appBuildVersion),
    },
    { label: 'Runtime Version', value: sanitize(submittedBuild?.runtime?.version) },
    { label: 'Fingerprint', value: submittedBuild?.fingerprint?.hash },
    { label: 'Commit', value: sanitize(submittedBuild?.gitCommitHash) },
    { label: 'Error Code', value: sanitize(submission.error?.errorCode) },
    { label: 'Error Message', value: sanitize(submission.error?.message) },
    { label: 'Started at', value: new Date(submission.createdAt).toLocaleString() },
    {
      label: 'Finished at',
      value: submission.completedAt ? new Date(submission.completedAt).toLocaleString() : null,
    },
    { label: 'Submission Details', value: link(getSubmissionDetailsUrl(submission)) },
  ];

  const filteredFields = fields.filter(({ value }) => value !== undefined && value !== null) as {
    label: string;
    value: string;
  }[];
  return formatFields(filteredFields);
}
