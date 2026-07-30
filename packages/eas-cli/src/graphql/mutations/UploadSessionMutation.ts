import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AccountUploadSessionType,
  AppUploadSessionType,
  CreateAccountScopedUploadSessionMutation,
  CreateAccountScopedUploadSessionMutationVariables,
  CreateAppScopedUploadSessionMutation,
  CreateAppScopedUploadSessionMutationVariables,
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
    type: UploadSessionType,
    filename?: string
  ): Promise<SignedUrl> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateUploadSessionMutation, CreateUploadSessionMutationVariables>(
          gql`
            mutation CreateUploadSessionMutation($type: UploadSessionType!, $filename: String) {
              uploadSession {
                createUploadSession(type: $type, filename: $filename)
              }
            }
          `,
          {
            type,
            filename,
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
  async createAppScopedUploadSessionAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      type,
      appID,
    }: {
      type: AppUploadSessionType;
      appID: string;
    }
  ): Promise<SignedUrl> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          CreateAppScopedUploadSessionMutation,
          CreateAppScopedUploadSessionMutationVariables
        >(
          gql`
            mutation CreateAppScopedUploadSessionMutation($appID: ID!, $type: AppUploadSessionType!) {
              uploadSession {
                createAppScopedUploadSession(appID: $appID, type: $type)
              }
            }
          `,
          {
            type,
            appID,
          }
        )
        .toPromise()
    );
    return data.uploadSession.createAppScopedUploadSession;
  },
};
