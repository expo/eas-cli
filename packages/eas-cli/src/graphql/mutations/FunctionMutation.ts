import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  CreateFunctionMutation,
  CreateFunctionMutationVariables,
  GetFunctionStatusMutation,
  GetFunctionStatusMutationVariables,
  GetSignedUploadFunctionMutation,
  GetSignedUploadFunctionMutationVariables,
} from '../generated';

export const FunctionMutation = {
  async uploadAsync(appId: string): Promise<string> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<GetSignedUploadFunctionMutation, GetSignedUploadFunctionMutationVariables>(
          gql`
            mutation GetSignedUploadFunctionMutation($appId: String!) {
              function {
                getSignedFunctionUploadSpecification(appId: $appId) {
                  specification
                }
              }
            }
          `,
          {
            appId,
          }
        )
        .toPromise()
    );
    return data.function.getSignedFunctionUploadSpecification.specification;
  },
  async createAsync(bucketKey: string, appId: string): Promise<boolean> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateFunctionMutation, CreateFunctionMutationVariables>(
          gql`
            mutation CreateFunctionMutation($bucketKey: String!, $appId: String!) {
              function {
                createFunction(bucketKey: $bucketKey, appId: $appId) {
                  success
                }
              }
            }
          `,
          {
            bucketKey,
            appId,
          }
        )
        .toPromise()
    );
    return data.function.createFunction.success;
  },
  async getStatusAsync(appId: string): Promise<{ status: string; logUrls: string[] }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<GetFunctionStatusMutation, GetFunctionStatusMutationVariables>(
          gql`
            mutation GetFunctionStatusMutation($appId: String!) {
              function {
                getFunctionStatus(appId: $appId) {
                  status
                  logUrls
                }
              }
            }
          `,
          {
            appId,
          }
        )
        .toPromise()
    );
    return data.function.getFunctionStatus;
  },
};
