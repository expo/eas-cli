import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CreateUploadSessionMutation,
  CreateUploadSessionMutationVariables,
  UploadSessionType,
} from '../generated';

export interface SignedUrl {
  url: string;
  headers: Record<string, string>;
  bucketKey: string;
}

export const UploadSessionMutation = {
  async createUploadSessionAsync(
    graphqlClient: ExpoGraphqlClient,
    type: UploadSessionType
  ): Promise<SignedUrl> {
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
