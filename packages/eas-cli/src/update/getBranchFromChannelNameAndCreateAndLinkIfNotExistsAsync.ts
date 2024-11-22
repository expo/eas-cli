import { ensureBranchExistsAsync } from '../branch/queries';
import { ChannelNotFoundError } from '../channel/errors';
import { createChannelOnAppAsync } from '../channel/queries';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { ChannelQuery } from '../graphql/queries/ChannelQuery';

export async function getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  channelName: string
): Promise<{ branchName: string; branchId: string }> {
  let branchInfo: { branchName: string; branchId: string };

  try {
    const channel = await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName,
    });

    if (channel.updateBranches.length === 1) {
      const branch = channel.updateBranches[0];
      branchInfo = { branchId: branch.id, branchName: branch.name };
    } else if (channel.updateBranches.length === 0) {
      throw new Error(
        "Channel has no branches associated with it. Run 'eas channel:edit' to map a branch"
      );
    } else {
      throw new Error(
        `Channel has multiple branches associated with it. Instead, use '--branch' instead of '--channel'`
      );
    }
  } catch (error) {
    if (!(error instanceof ChannelNotFoundError)) {
      throw error;
    }

    const { branch } = await ensureBranchExistsAsync(graphqlClient, {
      appId: projectId,
      branchName: channelName,
    });
    const {
      updateChannel: { createUpdateChannelForApp: newChannel },
    } = await createChannelOnAppAsync(graphqlClient, {
      appId: projectId,
      channelName,
      branchId: branch.id,
    });

    if (!newChannel) {
      throw new Error(
        `Could not create channel with name ${channelName} on project with id ${projectId}`
      );
    }

    branchInfo = { branchId: branch.id, branchName: channelName };
  }

  return branchInfo;
}
