import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { CreatePostHogAccountRequestInput, SetupPostHogProjectInput } from '../generated';
import {
  PostHogOrganizationConnectionData,
  PostHogOrganizationConnectionFragmentNode,
  PostHogProjectData,
  PostHogProjectFragmentNode,
} from '../types/PostHogConnection';

type CreatePostHogAccountRequestMutation = {
  posthogOrganizationConnection: {
    createPostHogAccountRequest: PostHogOrganizationConnectionData;
  };
};

type CreatePostHogAccountRequestMutationVariables = {
  input: CreatePostHogAccountRequestInput;
};

type SetupPostHogProjectMutation = {
  posthogProject: {
    setupPostHogProject: PostHogProjectData;
  };
};

type SetupPostHogProjectMutationVariables = {
  input: SetupPostHogProjectInput;
};

export const PostHogMutation = {
  async createPostHogAccountRequestAsync(
    graphqlClient: ExpoGraphqlClient,
    input: CreatePostHogAccountRequestInput
  ): Promise<PostHogOrganizationConnectionData> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          CreatePostHogAccountRequestMutation,
          CreatePostHogAccountRequestMutationVariables
        >(
          gql`
            mutation CreatePostHogAccountRequest($input: CreatePostHogAccountRequestInput!) {
              posthogOrganizationConnection {
                createPostHogAccountRequest(input: $input) {
                  id
                  ...PostHogOrganizationConnectionFragment
                }
              }
            }
            ${print(PostHogOrganizationConnectionFragmentNode)}
          `,
          { input }
        )
        .toPromise()
    );
    return data.posthogOrganizationConnection.createPostHogAccountRequest;
  },

  async setupPostHogProjectAsync(
    graphqlClient: ExpoGraphqlClient,
    input: SetupPostHogProjectInput
  ): Promise<PostHogProjectData> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<SetupPostHogProjectMutation, SetupPostHogProjectMutationVariables>(
          gql`
            mutation SetupPostHogProject($input: SetupPostHogProjectInput!) {
              posthogProject {
                setupPostHogProject(input: $input) {
                  id
                  ...PostHogProjectFragment
                }
              }
            }
            ${print(PostHogOrganizationConnectionFragmentNode)}
            ${print(PostHogProjectFragmentNode)}
          `,
          { input }
        )
        .toPromise()
    );
    return data.posthogProject.setupPostHogProject;
  },
};
