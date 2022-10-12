import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CreateUploadSessionMutation,
  CreateUploadSessionMutationVariables,
  UploadSessionType,
} from '../generated';

export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
}

export const UploadSessionMutation = {
  async createUploadSessionAsync(
    graphqlClient: ExpoGraphqlClient,
    type: UploadSessionType
  ): Promise<PresignedPost> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateUploadSessionMutation, CreateUploadSessionMutationVariables>(
          gql`
            mutation CreateUploadSessionMutation($type: UploadSessionType!) {
              uploadSession {
                createUploadSession(type: $type)
              }
            }
          `,
          {
            type,
          }
        )
        .toPromise()
    );
    return data.uploadSession.createUploadSession;
  },
};
