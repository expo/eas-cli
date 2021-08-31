import ora from 'ora';

import { AppPlatform, SubmissionFragment, SubmissionStatus } from '../../graphql/generated';
import { SubmissionQuery } from '../../graphql/queries/SubmissionQuery';
import Log from '../../log';
import { sleep } from '../../utils/promise';

const APP_STORE_NAMES: Record<AppPlatform, string> = {
  [AppPlatform.Android]: 'Google Play Store',
  [AppPlatform.Ios]: 'Apple App Store',
};

const CHECK_TIMEOUT_MS = 3600_000;
const CHECK_INTERVAL_MS = 5_000;

export async function waitForSubmissionsEndAsync(
  initialSubmissions: SubmissionFragment[]
): Promise<SubmissionFragment[]> {
  Log.log(
    `Waiting for submission${
      initialSubmissions.length > 1 ? 's' : ''
    } to complete. You can press Ctrl+C to exit.`
  );

  const spinner = ora(`Submitting`).start();

  let time = new Date().getTime();
  const timeoutTime = time + CHECK_TIMEOUT_MS;
  while (time <= timeoutTime) {
    const submissions = await Promise.all(
      initialSubmissions.map(({ id }) => SubmissionQuery.byIdAsync(id, { useCache: false }))
    );

    if (submissions.length === 1) {
      const [submission] = submissions;
      spinner.text = getSingleSpinnerText(submission);
      if (submission.status === SubmissionStatus.Finished) {
        spinner.succeed();
        return submissions;
      } else if (submission.status === SubmissionStatus.Errored) {
        spinner.fail();
        return submissions;
      } else if (submission.status === SubmissionStatus.Canceled) {
        spinner.warn();
        return submissions;
      }
    } else {
      spinner.text = getMultipleSpinnerText(submissions);

      const finished = countWithStatus(submissions, SubmissionStatus.Finished);
      const errored = countWithStatus(submissions, SubmissionStatus.Errored);
      const canceled = countWithStatus(submissions, SubmissionStatus.Canceled);
      const nonCompleted = submissions.length - (finished + errored + canceled);
      if (nonCompleted === 0) {
        if (finished === submissions.length) {
          spinner.succeed('All submissions have finished');
        } else {
          spinner.fail('Some submissions were canceled or failed');
        }
        return submissions;
      }
    }

    time = new Date().getTime();
    await sleep(CHECK_INTERVAL_MS);
  }
  spinner.warn('Timed out');
  throw new Error('Timeout reached! It is taking longer than expected to complete, aborting...');
}

function getSingleSpinnerText(submission: SubmissionFragment): string {
  const { platform, status } = submission;
  const appStoreName = APP_STORE_NAMES[platform];
  switch (status) {
    case SubmissionStatus.AwaitingBuild:
      return `Submitting your app to ${appStoreName}: waiting for the associated build to complete`;
    case SubmissionStatus.InQueue:
      return `Submitting your app to ${appStoreName}: waiting for an available submitter`;
    case SubmissionStatus.InProgress:
      return `Submitting your app to ${appStoreName}: submission in progress`;
    case SubmissionStatus.Finished:
      return `Submitted your app to ${appStoreName}!`;
    case SubmissionStatus.Errored:
      return `Something went wrong when submitting your app to ${appStoreName}.`;
    case SubmissionStatus.Canceled:
      return 'The submission has been canceled';
  }
}

function getMultipleSpinnerText(submissions: SubmissionFragment[]): string {
  const awaitingSubmissions = countWithStatus(submissions, SubmissionStatus.AwaitingBuild);
  const inQueue = countWithStatus(submissions, SubmissionStatus.InQueue);
  const inProgress = countWithStatus(submissions, SubmissionStatus.InProgress);
  const finished = countWithStatus(submissions, SubmissionStatus.Finished);
  const errored = countWithStatus(submissions, SubmissionStatus.Errored);
  const canceled = countWithStatus(submissions, SubmissionStatus.Canceled);
  const text = [
    awaitingSubmissions && `Awaiting submissions: ${awaitingSubmissions}`,
    inQueue && `Submissions in queue: ${inQueue}`,
    inProgress && `Submissions in progress: ${inProgress}`,
    canceled && `Canceled submissions: ${canceled}`,
    errored && `Failed submissions: ${errored}`,
    finished && `Finished submissions: ${finished}`,
  ]
    .filter(i => i)
    .join('\t');
  return text;
}

function countWithStatus(submissions: SubmissionFragment[], status: SubmissionStatus): number {
  return submissions.filter(submission => submission.status === status).length;
}
