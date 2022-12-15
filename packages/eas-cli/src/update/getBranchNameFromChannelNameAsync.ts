import { ensureBranchExistsAsync } from '../branch/queries';
import { ChannelNotFoundError } from '../channel/errors';
import { createChannelOnAppAsync } from '../channel/queries';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { ChannelQuery } from '../graphql/queries/ChannelQuery';

export async function getBranchNameFromChannelNameAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  channelName: string
): Promise<string> {
  let branchName;

  try {
    const channel = await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName,
    });

    if (channel.updateBranches.length === 1) {
      branchName = channel.updateBranches[0].name;
    } else if (channel.updateBranches.length === 0) {
      throw new Error(
        "Channel has no branches associated with it. Run 'eas channel:edit' to map a branch"
      );
    } else {
      throw new Error(
        "Channel has multiple branches associated with it. Instead, use 'eas update --branch'"
      );
    }
  } catch (error) {
    if (!(error instanceof ChannelNotFoundError)) {
      throw error;
    }

    const { branchId } = await ensureBranchExistsAsync(graphqlClient, {
      appId: projectId,
      branchName: channelName,
    });
    const {
      updateChannel: { createUpdateChannelForApp: newChannel },
    } = await createChannelOnAppAsync(graphqlClient, {
      appId: projectId,
      channelName,
      branchId,
    });

    if (!newChannel) {
      throw new Error(
        `Could not create channel with name ${channelName} on project with id ${projectId}`
      );
    }

    branchName = channelName;
  }

  return branchName;
}
