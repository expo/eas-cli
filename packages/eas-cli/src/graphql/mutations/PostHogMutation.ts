import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { CreatePostHogAccountRequestInput, SetupPostHogProjectInput } from '../generated';
import {
  PostHogOrganizationConnectionFragmentNode,
  PostHogProjectData,
  PostHogProjectFragmentNode,
  StartPostHogConnectionResult,
} from '../types/PostHogConnection';

type StartPostHogConnectionMutation = {
  posthogOrganizationConnection: {
    startPostHogConnection: StartPostHogConnectionResult;
  };
};

type StartPostHogConnectionMutationVariables = {
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

type DeletePostHogProjectMutation = {
  posthogProject: {
    deletePostHogProject: string;
  };
};

type DeletePostHogProjectMutationVariables = {
  id: string;
};

export const PostHogMutation = {
  async startPostHogConnectionAsync(
    graphqlClient: ExpoGraphqlClient,
    input: CreatePostHogAccountRequestInput
  ): Promise<StartPostHogConnectionResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<StartPostHogConnectionMutation, StartPostHogConnectionMutationVariables>(
          gql`
            mutation StartPostHogConnection($input: CreatePostHogAccountRequestInput!) {
              posthogOrganizationConnection {
                startPostHogConnection(input: $input) {
                  __typename
                  ... on PostHogOrganizationConnection {
                    id
                    ...PostHogOrganizationConnectionFragment
                  }
                  ... on PostHogPendingConnection {
                    url
                  }
                }
              }
            }
            ${print(PostHogOrganizationConnectionFragmentNode)}
          `,
          { input },
          { additionalTypenames: ['PostHogOrganizationConnection'] }
        )
        .toPromise()
    );
    return data.posthogOrganizationConnection.startPostHogConnection;
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

  async deletePostHogProjectAsync(graphqlClient: ExpoGraphqlClient, id: string): Promise<string> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<DeletePostHogProjectMutation, DeletePostHogProjectMutationVariables>(
          gql`
            mutation DeletePostHogProject($id: ID!) {
              posthogProject {
                deletePostHogProject(id: $id)
              }
            }
          `,
          { id },
          { additionalTypenames: ['App', 'PostHogProject'] }
        )
        .toPromise()
    );
    return data.posthogProject.deletePostHogProject;
  },
};
