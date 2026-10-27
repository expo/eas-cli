import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform, SubmissionStatus } from '../../graphql/generated';
import { SubmissionMutation } from '../../graphql/mutations/SubmissionMutation';
import Log from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform } from '../../platform';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { confirmAsync, selectAsync } from '../../prompts';
import {
  formatSubmissionChoice,
  getRecentSubmissionsWithStatusesAsync,
} from '../../submit/queries';

const CANCELLABLE_STATUSES = [
  SubmissionStatus.AwaitingBuild,
  SubmissionStatus.InQueue,
  SubmissionStatus.InProgress,
];

export async function selectSubmissionToCancelAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  projectDisplayName: string,
  platform?: AppPlatform
): Promise<string | null> {
  const spinner = ora().start('Fetching the uncompleted submissions…');

  let cancellableSubmissions;
  try {
    cancellableSubmissions = await getRecentSubmissionsWithStatusesAsync(graphqlClient, {
      projectId,
      platform,
      statuses: CANCELLABLE_STATUSES,
    });
    spinner.stop();
  } catch (error) {
    spinner.fail(
      `Something went wrong and we couldn't fetch the submissions for the project ${projectDisplayName}.`
    );
    throw error;
  }
  if (cancellableSubmissions.length === 0) {
    Log.warn(`We couldn't find any uncompleted submissions for the project ${projectDisplayName}.`);
    return null;
  } else {
    const submissionId = await selectAsync<string>(
      'Which submission do you want to cancel?',
      cancellableSubmissions.map(submission => ({
        title: formatSubmissionChoice(submission),
        value: submission.id,
      }))
    );

    return (await confirmAsync({
      message: 'Are you sure you want to cancel it?',
    }))
      ? submissionId
      : null;
  }
}

export default class SubmissionCancel extends EasCommand {
  static override description = 'cancel a submission';

  static override args = {
    SUBMISSION_ID: Args.string({}),
  };

  static override flags = {
    ...EASNonInteractiveFlag,
    platform: Flags.option({
      char: 'p',
      description: 'Filter submissions by the platform if submission ID is not provided',
      options: Object.values(RequestedPlatform),
    })(),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { SUBMISSION_ID: submissionIdFromArg },
      flags: { 'non-interactive': nonInteractive, platform },
    } = await this.parse(SubmissionCancel);

    if (submissionIdFromArg && platform) {
      throw new Error(
        'Submission ID cannot be used together with the platform flag. The flag is used to filter the list of submissions when not providing the submission ID'
      );
    }

    if (!submissionIdFromArg && nonInteractive) {
      throw new Error('Submission ID must be provided in non-interactive mode');
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SubmissionCancel, {
      nonInteractive,
    });

    let submissionId: string | null = submissionIdFromArg ?? null;
    if (!submissionId) {
      const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);

      submissionId = await selectSubmissionToCancelAsync(
        graphqlClient,
        projectId,
        displayName,
        toAppPlatform(platform)
      );
      if (!submissionId) {
        return;
      }
    }

    const spinner = ora().start('Canceling the submission…');
    try {
      const { status } = await SubmissionMutation.cancelSubmissionAsync(
        graphqlClient,
        submissionId
      );
      if (status === SubmissionStatus.Canceled) {
        spinner.succeed('Submission canceled');
      } else {
        spinner.text = 'Submission is already completed';
        spinner.stopAndPersist();
      }
    } catch (error) {
      spinner.fail(`Something went wrong and we couldn't cancel your submission ${submissionId}`);
      throw error;
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
