import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  BuildFragment,
  BuildMetadataInput,
  CreateLocalBuildMutation,
  LocalBuildArchiveSourceInput,
  LocalBuildJobInput,
} from '../generated';
import { BuildFragmentNode } from '../types/Build';

export const LocalBuildMutation = {
  async createLocalBuildAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string,
    job: LocalBuildJobInput,
    artifactSource: LocalBuildArchiveSourceInput,
    metadata: BuildMetadataInput
  ): Promise<BuildFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateLocalBuildMutation>(
          gql`
            mutation createLocalBuildMutation(
              $appId: ID!
              $jobInput: LocalBuildJobInput!
              $artifactSource: LocalBuildArchiveSourceInput!
              $metadata: BuildMetadataInput
            ) {
              build {
                createLocalBuild(
                  appId: $appId
                  job: $jobInput
                  artifactSource: $artifactSource
                  metadata: $metadata
                ) {
                  build {
                    id
                    ...BuildFragment
                  }
                }
              }
            }
            ${print(BuildFragmentNode)}
          `,
          { appId, jobInput: job, artifactSource, metadata }
        )
        .toPromise()
    );
    return data.build.createLocalBuild.build;
  },
};
