import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AccountUploadSessionType,
  CreateAccountScopedUploadSessionMutation,
  CreateAccountScopedUploadSessionMutationVariables,
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
  async createAccountScopedUploadSessionAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      type,
      accountID,
    }: {
      type: AccountUploadSessionType;
      accountID: string;
    }
  ): Promise<SignedUrl> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          CreateAccountScopedUploadSessionMutation,
          CreateAccountScopedUploadSessionMutationVariables
        >(
          gql`
            mutation CreateAccountScopedUploadSessionMutation(
              $accountID: ID!
              $type: AccountUploadSessionType!
            ) {
              uploadSession {
                createAccountScopedUploadSession(accountID: $accountID, type: $type)
              }
            }
          `,
          {
            type,
            accountID,
          }
        )
        .toPromise()
    );
    return data.uploadSession.createAccountScopedUploadSession;
  },
};
