import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  BuildFragment,
  BuildMetadataInput,
  ShareArchiveSourceInput,
  ShareJobInput,
  UploadLocalBuildMutation,
} from '../generated';
import { BuildFragmentNode } from '../types/Build';

export const ShareBuildMutation = {
  async uploadLocalBuildAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string,
    job: ShareJobInput,
    artifactSource: ShareArchiveSourceInput,
    metadata: BuildMetadataInput
  ): Promise<BuildFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UploadLocalBuildMutation>(
          gql`
            mutation uploadLocalBuildMutation(
              $appId: ID!
              $jobInput: ShareJobInput!
              $artifactSource: ShareArchiveSourceInput!
              $metadata: BuildMetadataInput
            ) {
              build {
                createShareBuild(
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
    return data.build.createShareBuild.build;
  },
};
