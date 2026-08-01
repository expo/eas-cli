import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import {
  EasPaginatedQueryFlags,
  getLimitFlagWithCustomValues,
  getPaginatedQueryOptions,
} from '../../commandUtils/pagination';
import { AppPlatform, SubmissionStatus as GraphQLSubmissionStatus } from '../../graphql/generated';
import { RequestedPlatform } from '../../platform';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { SUBMISSIONS_LIMIT, listAndRenderSubmissionsOnAppAsync } from '../../submit/queries';
import { enableJsonOutput } from '../../utils/json';

enum SubmissionStatus {
  AWAITING_BUILD = 'awaiting-build',
  IN_QUEUE = 'in-queue',
  IN_PROGRESS = 'in-progress',
  FINISHED = 'finished',
  ERRORED = 'errored',
  CANCELED = 'canceled',
}

export default class SubmissionList extends EasCommand {
  static override description = 'list submissions for your project';

  static override flags = {
    platform: Flags.option({
      options: Object.values(RequestedPlatform),
      char: 'p',
    })(),
    status: Flags.option({
      options: Object.values(SubmissionStatus),
      description: 'Filter only submissions with the specified status',
    })(),
    ...EasPaginatedQueryFlags,
    limit: getLimitFlagWithCustomValues({ defaultTo: 10, limit: SUBMISSIONS_LIMIT }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SubmissionList);
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const { platform: requestedPlatform, status: submissionStatus } = flags;
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SubmissionList, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    const platform = toAppPlatform(requestedPlatform);
    const graphqlSubmissionStatus = toGraphQLSubmissionStatus(submissionStatus);
    const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);

    await listAndRenderSubmissionsOnAppAsync(graphqlClient, {
      projectId,
      projectDisplayName: displayName,
      filter: {
        platform,
        status: graphqlSubmissionStatus,
      },
      paginatedQueryOptions,
    });
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

const toGraphQLSubmissionStatus = (
  submissionStatus?: SubmissionStatus
): GraphQLSubmissionStatus | undefined => {
  if (!submissionStatus) {
    return undefined;
  } else if (submissionStatus === SubmissionStatus.AWAITING_BUILD) {
    return GraphQLSubmissionStatus.AwaitingBuild;
  } else if (submissionStatus === SubmissionStatus.IN_QUEUE) {
    return GraphQLSubmissionStatus.InQueue;
  } else if (submissionStatus === SubmissionStatus.IN_PROGRESS) {
    return GraphQLSubmissionStatus.InProgress;
  } else if (submissionStatus === SubmissionStatus.FINISHED) {
    return GraphQLSubmissionStatus.Finished;
  } else if (submissionStatus === SubmissionStatus.ERRORED) {
    return GraphQLSubmissionStatus.Errored;
  } else {
    return GraphQLSubmissionStatus.Canceled;
  }
};
