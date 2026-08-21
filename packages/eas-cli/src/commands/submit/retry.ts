import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { AppPlatform, SubmissionStatus } from '../../graphql/generated';
import { SubmissionMutation } from '../../graphql/mutations/SubmissionMutation';
import { SubmissionQuery } from '../../graphql/queries/SubmissionQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform } from '../../platform';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { selectAsync } from '../../prompts';
import {
  formatSubmissionChoice,
  getRecentSubmissionsWithStatusesAsync,
} from '../../submit/queries';
import { printSubmissionDetailsUrls } from '../../submit/utils/urls';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

async function selectSubmissionToRetryAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  projectDisplayName: string,
  platform?: AppPlatform
): Promise<string | null> {
  const spinner = ora().start('Fetching the retryable submissions…');

  let submissions;
  try {
    // Only failed submissions can be retried, so filter by status on the server — recent
    // finished submissions must not push retryable ones off the page.
    submissions = await getRecentSubmissionsWithStatusesAsync(graphqlClient, {
      projectId,
      platform,
      statuses: [SubmissionStatus.Errored],
    });
    spinner.stop();
  } catch (error) {
    spinner.fail(
      `Something went wrong and we couldn't fetch the submissions for the project ${projectDisplayName}.`
    );
    throw error;
  }
  const retryableSubmissions = submissions.filter(submission => submission.canRetry);
  if (retryableSubmissions.length === 0) {
    Log.warn(
      `We couldn't find any retryable submissions for the project ${projectDisplayName}. Submissions can be retried only for a limited time after they fail.`
    );
    return null;
  }
  return await selectAsync<string>(
    'Which submission do you want to retry?',
    retryableSubmissions.map(submission => ({
      title: formatSubmissionChoice(submission),
      value: submission.id,
    }))
  );
}

export default class SubmissionRetry extends EasCommand {
  static override description = 'retry a failed submission';

  static override args = {
    SUBMISSION_ID: Args.string({}),
  };

  static override flags = {
    platform: Flags.option({
      char: 'p',
      description: 'Filter submissions by the platform if submission ID is not provided',
      options: Object.values(RequestedPlatform),
    })(),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { SUBMISSION_ID: submissionIdFromArg },
      flags,
    } = await this.parse(SubmissionRetry);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (submissionIdFromArg && flags.platform) {
      throw new Error(
        'Submission ID cannot be used together with the platform flag. The flag is used to filter the list of submissions when not providing the submission ID'
      );
    }

    if (!submissionIdFromArg && nonInteractive) {
      throw new Error('Submission ID must be provided in non-interactive mode');
    }

    if (jsonFlag) {
      enableJsonOutput();
    }
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SubmissionRetry, {
      nonInteractive,
    });

    let submissionId: string | null = submissionIdFromArg ?? null;
    if (!submissionId) {
      const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);

      submissionId = await selectSubmissionToRetryAsync(
        graphqlClient,
        projectId,
        displayName,
        toAppPlatform(flags.platform)
      );
      if (!submissionId) {
        return;
      }
    } else {
      const submission = await SubmissionQuery.byIdWithSubmittedBuildAsync(
        graphqlClient,
        submissionId
      );
      if (!submission.canRetry) {
        const retryWindowHint =
          submission.maxRetryTimeMinutes > 0
            ? `, for up to ${submission.maxRetryTimeMinutes} minutes after they complete`
            : '';
        throw new Error(
          `Submission ${submissionId} cannot be retried. Only failed submissions can be retried${retryWindowHint}.`
        );
      }
    }

    const spinner = ora().start('Retrying the submission…');
    let retriedSubmission;
    try {
      retriedSubmission = await SubmissionMutation.retrySubmissionAsync(
        graphqlClient,
        submissionId
      );
      spinner.succeed('Created a new submission');
    } catch (error) {
      spinner.fail(`Something went wrong and we couldn't retry your submission ${submissionId}`);
      throw error;
    }

    if (jsonFlag) {
      printJsonOnlyOutput(retriedSubmission);
    } else {
      printSubmissionDetailsUrls([retriedSubmission]);
    }
  }
}

const toAppPlatform = (requestedPlatform?: RequestedPlatform): AppPlatform | undefined => {
  if (!requestedPlatform || requestedPlatform === RequestedPlatform.All) {
    return undefined;
  } else if (requestedPlatform === RequestedPlatform.Android) {
    return AppPlatform.Android;
  } else {
    return AppPlatform.Ios;
  }
};
