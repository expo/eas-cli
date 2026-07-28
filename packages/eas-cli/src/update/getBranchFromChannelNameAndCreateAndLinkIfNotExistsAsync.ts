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
  let channel;
  try {
    channel = await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName,
    });
  } catch (error) {
    if (!(error instanceof ChannelNotFoundError)) {
      throw error;
    }
    return await createAndLinkBranchToChannelAsync(graphqlClient, projectId, channelName);
  }

  if (channel.updateBranches.length === 1) {
    const branch = channel.updateBranches[0];
    return { branchId: branch.id, branchName: branch.name };
  }

  if (channel.updateBranches.length === 0) {
    return await createAndLinkBranchToChannelAsync(graphqlClient, projectId, channelName);
  }

  throw new Error(
    `Channel has multiple branches associated with it. Instead, use '--branch' instead of '--channel'`
  );
}

async function createAndLinkBranchToChannelAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  channelName: string
): Promise<{ branchName: string; branchId: string }> {
  const { branch } = await ensureBranchExistsAsync(graphqlClient, {
    appId: projectId,
    branchName: channelName,
  });
  await createChannelOnAppAsync(graphqlClient, {
    appId: projectId,
    channelName,
    branchId: branch.id,
  });

  return { branchId: branch.id, branchName: channelName };
}
