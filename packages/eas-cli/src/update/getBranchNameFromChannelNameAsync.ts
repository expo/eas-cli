import { ensureBranchExistsAsync, selectBranchOnAppAsync } from '../branch/queries';
import { getAlwaysTrueBranchMapping } from '../channel/branch-mapping';
import { ChannelNotFoundError } from '../channel/errors';
import { createChannelOnAppAsync } from '../channel/queries';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { PaginatedQueryOptions } from '../commandUtils/pagination';
import { updateChannelBranchMappingAsync } from '../commands/channel/edit';
import { ChannelQuery } from '../graphql/queries/ChannelQuery';
import Log from '../log';

export async function getBranchNameFromChannelNameAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  channelName: string,
  paginatedQueryOptions: PaginatedQueryOptions
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
      Log.log('Channel has no branches associated with it.');
      const branch = await selectBranchOnAppAsync(graphqlClient, {
        projectId,
        promptTitle: `Which branch would you like ${channel.name} to point at?`,
        displayTextForListItem: updateBranch => ({ title: updateBranch.name }),
        paginatedQueryOptions,
      });

      await updateChannelBranchMappingAsync(graphqlClient, {
        channelId: channel.id,
        branchMapping: JSON.stringify(getAlwaysTrueBranchMapping(branch.id)),
      });
      return branch.name;
    } else {
      throw new Error(
        `Channel has multiple branches associated with it. Instead, use '--branch' instead of '--channel'`
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
