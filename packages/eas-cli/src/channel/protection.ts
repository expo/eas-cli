import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../graphql/client';
import {
  ProtectUpdateChannelMutation,
  ProtectUpdateChannelMutationVariables,
  UnprotectUpdateChannelMutation,
  UnprotectUpdateChannelMutationVariables,
  UpdateChannelBasicInfoFragment,
} from '../graphql/generated';
import { UpdateChannelBasicInfoFragmentNode } from '../graphql/types/UpdateChannelBasicInfo';

export async function protectUpdateChannelAsync(
  graphqlClient: ExpoGraphqlClient,
  { channelId }: ProtectUpdateChannelMutationVariables
): Promise<UpdateChannelBasicInfoFragment> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<ProtectUpdateChannelMutation, ProtectUpdateChannelMutationVariables>(
        gql`
          mutation ProtectUpdateChannel($channelId: ID!) {
            updateChannel {
              protectUpdateChannel(channelId: $channelId) {
                id
                ...UpdateChannelBasicInfoFragment
              }
            }
          }
          ${print(UpdateChannelBasicInfoFragmentNode)}
        `,
        { channelId }
      )
      .toPromise()
  );
  const channel = data.updateChannel.protectUpdateChannel;
  if (!channel) {
    throw new Error(`Could not find a channel with id: ${channelId}`);
  }
  return channel;
}

export async function unprotectUpdateChannelAsync(
  graphqlClient: ExpoGraphqlClient,
  { channelId }: UnprotectUpdateChannelMutationVariables
): Promise<UpdateChannelBasicInfoFragment> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<UnprotectUpdateChannelMutation, UnprotectUpdateChannelMutationVariables>(
        gql`
          mutation UnprotectUpdateChannel($channelId: ID!) {
            updateChannel {
              unprotectUpdateChannel(channelId: $channelId) {
                id
                ...UpdateChannelBasicInfoFragment
              }
            }
          }
          ${print(UpdateChannelBasicInfoFragmentNode)}
        `,
        { channelId }
      )
      .toPromise()
  );
  const channel = data.updateChannel.unprotectUpdateChannel;
  if (!channel) {
    throw new Error(`Could not find a channel with id: ${channelId}`);
  }
  return channel;
}
