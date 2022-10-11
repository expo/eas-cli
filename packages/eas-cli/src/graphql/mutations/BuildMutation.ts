import { print } from 'graphql';
import gql from 'graphql-tag';
import nullthrows from 'nullthrows';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AndroidJobInput,
  BuildFragment,
  BuildMetadataInput,
  BuildParamsInput,
  CreateAndroidBuildMutation,
  CreateAndroidBuildMutationVariables,
  CreateIosBuildMutation,
  CreateIosBuildMutationVariables,
  EasBuildDeprecationInfo,
  IosJobInput,
} from '../generated';
import { BuildFragmentNode } from '../types/Build';

export interface BuildResult {
  build: BuildFragment;
  deprecationInfo?: EasBuildDeprecationInfo | null;
}

export const BuildMutation = {
  async createAndroidBuildAsync(
    graphqlClient: ExpoGraphqlClient,
    input: {
      appId: string;
      job: AndroidJobInput;
      metadata: BuildMetadataInput;
      buildParams: BuildParamsInput;
    }
  ): Promise<BuildResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAndroidBuildMutation, CreateAndroidBuildMutationVariables>(
          gql`
            mutation CreateAndroidBuildMutation(
              $appId: ID!
              $job: AndroidJobInput!
              $metadata: BuildMetadataInput
              $buildParams: BuildParamsInput
            ) {
              build {
                createAndroidBuild(
                  appId: $appId
                  job: $job
                  metadata: $metadata
                  buildParams: $buildParams
                ) {
                  build {
                    id
                    ...BuildFragment
                  }
                  deprecationInfo {
                    type
                    message
                  }
                }
              }
            }
            ${print(BuildFragmentNode)}
          `,
          input,
          { noRetry: true }
        )
        .toPromise()
    );
    return nullthrows(data.build?.createAndroidBuild);
  },
  async createIosBuildAsync(
    graphqlClient: ExpoGraphqlClient,
    input: {
      appId: string;
      job: IosJobInput;
      metadata: BuildMetadataInput;
      buildParams: BuildParamsInput;
    }
  ): Promise<BuildResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateIosBuildMutation, CreateIosBuildMutationVariables>(
          gql`
            mutation CreateIosBuildMutation(
              $appId: ID!
              $job: IosJobInput!
              $metadata: BuildMetadataInput
              $buildParams: BuildParamsInput
            ) {
              build {
                createIosBuild(
                  appId: $appId
                  job: $job
                  metadata: $metadata
                  buildParams: $buildParams
                ) {
                  build {
                    id
                    ...BuildFragment
                  }
                  deprecationInfo {
                    type
                    message
                  }
                }
              }
            }
            ${print(BuildFragmentNode)}
          `,
          input,
          { noRetry: true }
        )
        .toPromise()
    );
    return nullthrows(data.build?.createIosBuild);
  },
};
