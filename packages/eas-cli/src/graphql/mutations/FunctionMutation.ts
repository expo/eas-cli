import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  CreateFunctionMutation,
  CreateFunctionMutationVariables,
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
  async createAsync(bucketKey: string): Promise<boolean> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateFunctionMutation, CreateFunctionMutationVariables>(
          gql`
            mutation CreateFunctionMutation($bucketKey: String!) {
              function {
                createFunction(bucketKey: $bucketKey) {
                  success
                }
              }
            }
          `,
          {
            bucketKey,
          }
        )
        .toPromise()
    );
    return data.function.createFunction.success;
  },
};
