import { print } from 'graphql';
import gql from 'graphql-tag';
import nullthrows from 'nullthrows';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  AndroidJobInput,
  BuildFragment,
  BuildMetadataInput,
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
  async createAndroidBuildAsync(input: {
    appId: string;
    job: AndroidJobInput;
    metadata: BuildMetadataInput;
  }): Promise<BuildResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAndroidBuildMutation, CreateAndroidBuildMutationVariables>(
          gql`
            mutation CreateAndroidBuildMutation(
              $appId: ID!
              $job: AndroidJobInput!
              $metadata: BuildMetadataInput
            ) {
              build {
                createAndroidBuild(appId: $appId, job: $job, metadata: $metadata) {
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
  async createIosBuildAsync(input: {
    appId: string;
    job: IosJobInput;
    metadata: BuildMetadataInput;
  }): Promise<BuildResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateIosBuildMutation, CreateIosBuildMutationVariables>(
          gql`
            mutation CreateIosBuildMutation(
              $appId: ID!
              $job: IosJobInput!
              $metadata: BuildMetadataInput
            ) {
              build {
                createIosBuild(appId: $appId, job: $job, metadata: $metadata) {
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
