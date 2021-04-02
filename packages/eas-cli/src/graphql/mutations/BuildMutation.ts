import gql from 'graphql-tag';
import nullthrows from 'nullthrows';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  AndroidGenericJobInput,
  AndroidManagedJobInput,
  BuildMetadataInput,
  CreateAndroidGenericBuildMutation,
  CreateAndroidGenericBuildMutationVariables,
  CreateAndroidManagedBuildMutation,
  CreateAndroidManagedBuildMutationVariables,
  CreateIosGenericBuildMutation,
  CreateIosGenericBuildMutationVariables,
  CreateIosManagedBuildMutation,
  CreateIosManagedBuildMutationVariables,
  EasBuildDeprecationInfo,
  IosGenericJobInput,
  IosManagedJobInput,
} from '../generated';

export interface BuildResult {
  build: { id: string };
  deprecationInfo?: EasBuildDeprecationInfo | null;
}

const BuildMutation = {
  async createAndroidGenericBuildAsync(input: {
    appId: string;
    job: AndroidGenericJobInput;
    metadata: BuildMetadataInput;
  }): Promise<BuildResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAndroidGenericBuildMutation, CreateAndroidGenericBuildMutationVariables>(
          gql`
            mutation CreateAndroidGenericBuildMutation(
              $appId: ID!
              $job: AndroidGenericJobInput!
              $metadata: BuildMetadataInput
            ) {
              build {
                createAndroidGenericBuild(appId: $appId, job: $job, metadata: $metadata) {
                  build {
                    id
                  }
                  deprecationInfo {
                    type
                    message
                  }
                }
              }
            }
          `,
          input
        )
        .toPromise()
    );
    return nullthrows(data.build?.createAndroidGenericBuild);
  },
  async createAndroidManagedBuildAsync(input: {
    appId: string;
    job: AndroidManagedJobInput;
    metadata: BuildMetadataInput;
  }): Promise<BuildResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAndroidManagedBuildMutation, CreateAndroidManagedBuildMutationVariables>(
          gql`
            mutation CreateAndroidManagedBuildMutation(
              $appId: ID!
              $job: AndroidManagedJobInput!
              $metadata: BuildMetadataInput
            ) {
              build {
                createAndroidManagedBuild(appId: $appId, job: $job, metadata: $metadata) {
                  build {
                    id
                  }
                  deprecationInfo {
                    type
                    message
                  }
                }
              }
            }
          `,
          input
        )
        .toPromise()
    );
    return nullthrows(data.build?.createAndroidManagedBuild);
  },
  async createIosGenericBuildAsync(input: {
    appId: string;
    job: IosGenericJobInput;
    metadata: BuildMetadataInput;
  }): Promise<BuildResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateIosGenericBuildMutation, CreateIosGenericBuildMutationVariables>(
          gql`
            mutation CreateIosGenericBuildMutation(
              $appId: ID!
              $job: IosGenericJobInput!
              $metadata: BuildMetadataInput
            ) {
              build {
                createIosGenericBuild(appId: $appId, job: $job, metadata: $metadata) {
                  build {
                    id
                  }
                  deprecationInfo {
                    type
                    message
                  }
                }
              }
            }
          `,
          input
        )
        .toPromise()
    );
    return nullthrows(data.build?.createIosGenericBuild);
  },
  async createIosManagedBuildAsync(input: {
    appId: string;
    job: IosManagedJobInput;
    metadata: BuildMetadataInput;
  }): Promise<BuildResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateIosManagedBuildMutation, CreateIosManagedBuildMutationVariables>(
          gql`
            mutation CreateIosManagedBuildMutation(
              $appId: ID!
              $job: IosManagedJobInput!
              $metadata: BuildMetadataInput
            ) {
              build {
                createIosManagedBuild(appId: $appId, job: $job, metadata: $metadata) {
                  build {
                    id
                  }
                  deprecationInfo {
                    type
                    message
                  }
                }
              }
            }
          `,
          input
        )
        .toPromise()
    );
    return nullthrows(data.build?.createIosManagedBuild);
  },
};

export { BuildMutation };
