import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { AppPlatform, SubmissionWithSubmittedBuildFragment } from '../../graphql/generated';
import { SubmissionQuery } from '../../graphql/queries/SubmissionQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform } from '../../platform';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { getLatestSubmissionAsync } from '../../submit/queries';
import { formatGraphQLSubmission } from '../../submit/utils/formatSubmission';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

class NoSubmissionsFoundError extends Error {}

export default class SubmissionView extends EasCommand {
  static override description = 'view a submission for your project';

  static override args = {
    SUBMISSION_ID: Args.string({}),
  };

  static override flags = {
    platform: Flags.option({
      char: 'p',
      description:
        'Show the most recent submission for the platform when submission ID is not provided',
      options: Object.values(RequestedPlatform),
    })(),
    ...EasJsonOnlyFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { SUBMISSION_ID: submissionId },
      flags,
    } = await this.parse(SubmissionView);

    if (submissionId && flags.platform) {
      throw new Error(
        'Submission ID cannot be used together with the platform flag. The platform flag filters the submissions when no submission ID is provided'
      );
    }

    if (flags.json) {
      enableJsonOutput();
    }
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SubmissionView, {
      nonInteractive: true,
    });

    const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);

    const spinner = ora().start('Fetching the submission…');

    try {
      let submission: SubmissionWithSubmittedBuildFragment | null;

      if (submissionId) {
        submission = await SubmissionQuery.byIdWithSubmittedBuildAsync(graphqlClient, submissionId);
      } else {
        submission = await getLatestSubmissionAsync(graphqlClient, {
          projectId,
          filter: { platform: toAppPlatform(flags.platform) },
        });
        if (!submission) {
          spinner.fail(`Couldn't find any submissions for the project ${displayName}`);
          throw new NoSubmissionsFoundError(`No submissions found for the project ${displayName}`);
        }
      }

      if (submissionId) {
        spinner.succeed(`Found a matching submission for the project ${displayName}`);
      } else {
        spinner.succeed(`Showing the last submission for the project ${displayName}`);
      }

      if (flags.json) {
        printJsonOnlyOutput(submission);
      } else {
        Log.log(`\n${formatGraphQLSubmission(submission)}`);
      }
    } catch (err) {
      if (!(err instanceof NoSubmissionsFoundError)) {
        if (submissionId) {
          spinner.fail(
            `Something went wrong and we couldn't fetch the submission with id ${submissionId}`
          );
        } else {
          spinner.fail(
            `Something went wrong and we couldn't fetch the last submission for the project ${displayName}`
          );
        }
      }

      throw err;
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
