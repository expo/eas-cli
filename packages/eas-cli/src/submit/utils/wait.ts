import nullthrows from 'nullthrows';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform, SubmissionFragment, SubmissionStatus } from '../../graphql/generated';
import { SubmissionQuery } from '../../graphql/queries/SubmissionQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { sleepAsync } from '../../utils/promise';

const APP_STORE_NAMES: Record<AppPlatform, string> = {
  [AppPlatform.Android]: 'Google Play Store',
  [AppPlatform.Ios]: 'Apple App Store Connect',
};

const CHECK_INTERVAL_MS = 5_000;

export async function waitForSubmissionsEndAsync(
  graphqlClient: ExpoGraphqlClient,
  initialSubmissions: SubmissionFragment[]
): Promise<SubmissionFragment[]> {
  Log.log(
    `Waiting for submission${
      initialSubmissions.length > 1 ? 's' : ''
    } to complete. You can press Ctrl+C to exit.`
  );

  const spinner = ora(`Submitting`).start();

  while (true) {
    const submissions = await Promise.all(
      initialSubmissions.map(({ id }) => {
        try {
          return SubmissionQuery.byIdAsync(graphqlClient, id, { useCache: false });
        } catch (err) {
          Log.debug('Failed to fetch the submission status', err);
          return null;
        }
      })
    );

    if (submissions.length === 1) {
      const [submission] = submissions;
      if (submission !== null) {
        spinner.text = getSingleSpinnerText(submission);
        if (submission.status === SubmissionStatus.Finished) {
          spinner.succeed();
          return [submission];
        } else if (submission.status === SubmissionStatus.Errored) {
          spinner.fail();
          return [submission];
        } else if (submission.status === SubmissionStatus.Canceled) {
          spinner.warn();
          return [submission];
        }
      } else {
        if (!spinner.text) {
          spinner.text =
            'Could not fetch the submission status. Check your network connection. If the problem persists re-run the command with the EXPO_DEBUG=1 environment variable.';
        }
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
        return submissions.map(s => nullthrows(s));
      }
    }

    await sleepAsync(CHECK_INTERVAL_MS);
  }
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

function getMultipleSpinnerText(submissions: (SubmissionFragment | null)[]): string {
  const awaitingSubmissions = countWithStatus(submissions, SubmissionStatus.AwaitingBuild);
  const inQueue = countWithStatus(submissions, SubmissionStatus.InQueue);
  const inProgress = countWithStatus(submissions, SubmissionStatus.InProgress);
  const finished = countWithStatus(submissions, SubmissionStatus.Finished);
  const errored = countWithStatus(submissions, SubmissionStatus.Errored);
  const canceled = countWithStatus(submissions, SubmissionStatus.Canceled);
  const unknown =
    submissions.length - awaitingSubmissions - inQueue - inProgress - finished - errored - canceled;
  const text = [
    awaitingSubmissions && `Awaiting submissions: ${awaitingSubmissions}`,
    inQueue && `Submissions in queue: ${inQueue}`,
    inProgress && `Submissions in progress: ${inProgress}`,
    canceled && `Canceled submissions: ${canceled}`,
    errored && `Failed submissions: ${errored}`,
    finished && `Finished submissions: ${finished}`,
    unknown && `Submissions with unknown status: ${unknown}`,
  ]
    .filter(i => i)
    .join('\t');
  return text;
}

function countWithStatus(
  submissions: (SubmissionFragment | null)[],
  status: SubmissionStatus
): number {
  return submissions.filter(submission => submission?.status === status).length;
}
