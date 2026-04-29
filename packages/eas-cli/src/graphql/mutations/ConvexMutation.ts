import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CreateConvexTeamConnectionInput,
  SendConvexTeamInviteToVerifiedEmailInput,
  SetupConvexProjectInput,
} from '../generated';
import {
  ConvexProjectFragmentNode,
  ConvexTeamConnectionData,
  ConvexTeamConnectionFragmentNode,
  SetupConvexProjectResultData,
  SetupConvexProjectResultFragmentNode,
} from '../types/ConvexTeamConnection';

type CreateConvexTeamConnectionMutation = {
  convexTeamConnection: {
    createConvexTeamConnection: ConvexTeamConnectionData;
  };
};

type CreateConvexTeamConnectionMutationVariables = {
  convexTeamConnectionData: CreateConvexTeamConnectionInput;
};

type DeleteConvexTeamConnectionMutation = {
  convexTeamConnection: {
    deleteConvexTeamConnection: ConvexTeamConnectionData;
  };
};

type DeleteConvexTeamConnectionMutationVariables = {
  convexTeamConnectionId: string;
};

type SetupConvexProjectMutation = {
  convexProject: {
    setupConvexProject: SetupConvexProjectResultData;
  };
};

type SetupConvexProjectMutationVariables = {
  input: SetupConvexProjectInput;
};

type DeleteConvexProjectMutation = {
  convexProject: {
    deleteConvexProject: string;
  };
};

type DeleteConvexProjectMutationVariables = {
  convexProjectId: string;
};

type SendConvexTeamInviteToVerifiedEmailMutation = {
  convexTeamConnection: {
    sendConvexTeamInviteToVerifiedEmail: boolean;
  };
};

type SendConvexTeamInviteToVerifiedEmailMutationVariables = {
  input: SendConvexTeamInviteToVerifiedEmailInput;
};

export const ConvexMutation = {
  async createConvexTeamConnectionAsync(
    graphqlClient: ExpoGraphqlClient,
    input: CreateConvexTeamConnectionInput
  ): Promise<ConvexTeamConnectionData> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateConvexTeamConnectionMutation, CreateConvexTeamConnectionMutationVariables>(
          gql`
            mutation CreateConvexTeamConnection(
              $convexTeamConnectionData: CreateConvexTeamConnectionInput!
            ) {
              convexTeamConnection {
                createConvexTeamConnection(
                  convexTeamConnectionData: $convexTeamConnectionData
                ) {
                  id
                  ...ConvexTeamConnectionFragment
                }
              }
            }
            ${print(ConvexTeamConnectionFragmentNode)}
          `,
          { convexTeamConnectionData: input }
        )
        .toPromise()
    );
    return data.convexTeamConnection.createConvexTeamConnection;
  },

  async deleteConvexTeamConnectionAsync(
    graphqlClient: ExpoGraphqlClient,
    convexTeamConnectionId: string
  ): Promise<ConvexTeamConnectionData> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<DeleteConvexTeamConnectionMutation, DeleteConvexTeamConnectionMutationVariables>(
          gql`
            mutation DeleteConvexTeamConnection($convexTeamConnectionId: ID!) {
              convexTeamConnection {
                deleteConvexTeamConnection(
                  convexTeamConnectionId: $convexTeamConnectionId
                ) {
                  id
                  ...ConvexTeamConnectionFragment
                }
              }
            }
            ${print(ConvexTeamConnectionFragmentNode)}
          `,
          { convexTeamConnectionId }
        )
        .toPromise()
    );
    return data.convexTeamConnection.deleteConvexTeamConnection;
  },

  async setupConvexProjectAsync(
    graphqlClient: ExpoGraphqlClient,
    input: SetupConvexProjectInput
  ): Promise<SetupConvexProjectResultData> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<SetupConvexProjectMutation, SetupConvexProjectMutationVariables>(
          gql`
            mutation SetupConvexProject($input: SetupConvexProjectInput!) {
              convexProject {
                setupConvexProject(input: $input) {
                  ...SetupConvexProjectResultFragment
                }
              }
            }
            ${print(ConvexTeamConnectionFragmentNode)}
            ${print(ConvexProjectFragmentNode)}
            ${print(SetupConvexProjectResultFragmentNode)}
          `,
          { input }
        )
        .toPromise()
    );
    return data.convexProject.setupConvexProject;
  },

  async deleteConvexProjectAsync(
    graphqlClient: ExpoGraphqlClient,
    convexProjectId: string
  ): Promise<string> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<DeleteConvexProjectMutation, DeleteConvexProjectMutationVariables>(
          gql`
            mutation DeleteConvexProject($convexProjectId: ID!) {
              convexProject {
                deleteConvexProject(convexProjectId: $convexProjectId)
              }
            }
          `,
          { convexProjectId }
        )
        .toPromise()
    );
    return data.convexProject.deleteConvexProject;
  },

  async sendConvexTeamInviteToVerifiedEmailAsync(
    graphqlClient: ExpoGraphqlClient,
    input: SendConvexTeamInviteToVerifiedEmailInput
  ): Promise<boolean> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          SendConvexTeamInviteToVerifiedEmailMutation,
          SendConvexTeamInviteToVerifiedEmailMutationVariables
        >(
          gql`
            mutation SendConvexTeamInviteToVerifiedEmail($input: SendConvexTeamInviteToVerifiedEmailInput!) {
              convexTeamConnection {
                sendConvexTeamInviteToVerifiedEmail(input: $input)
              }
            }
          `,
          { input }
        )
        .toPromise()
    );
    return data.convexTeamConnection.sendConvexTeamInviteToVerifiedEmail;
  },
};
