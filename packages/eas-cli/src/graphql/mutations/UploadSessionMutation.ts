import { gql } from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client.js';
import {
  CreateUploadSessionMutation,
  CreateUploadSessionMutationVariables,
  UploadSessionType,
} from '../generated.js';

export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
}

export const UploadSessionMutation = {
  async createUploadSessionAsync(type: UploadSessionType): Promise<PresignedPost> {
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
