import gql from 'graphql-tag';

import { ConvexProject, ConvexTeamConnection, SetupConvexProjectResult } from '../generated';

export type ConvexTeamConnectionData = Pick<
  ConvexTeamConnection,
  | 'id'
  | 'convexTeamIdentifier'
  | 'convexTeamName'
  | 'convexTeamSlug'
  | 'createdAt'
  | 'updatedAt'
  | 'invitedAt'
  | 'invitedEmail'
>;

export type ConvexProjectData = Pick<
  ConvexProject,
  | 'id'
  | 'convexProjectIdentifier'
  | 'convexProjectName'
  | 'convexProjectSlug'
  | 'createdAt'
  | 'updatedAt'
> & {
  convexTeamConnection: ConvexTeamConnectionData;
};

export type SetupConvexProjectResultData = Pick<
  SetupConvexProjectResult,
  'convexDeploymentName' | 'convexDeploymentUrl' | 'deployKey'
> & {
  convexProject: ConvexProjectData;
};

export const ConvexTeamConnectionFragmentNode = gql`
  fragment ConvexTeamConnectionFragment on ConvexTeamConnection {
    id
    convexTeamIdentifier
    convexTeamName
    convexTeamSlug
    createdAt
    updatedAt
    invitedAt
    invitedEmail
  }
`;

export const ConvexProjectFragmentNode = gql`
  fragment ConvexProjectFragment on ConvexProject {
    id
    convexProjectIdentifier
    convexProjectName
    convexProjectSlug
    createdAt
    updatedAt
    convexTeamConnection {
      id
      ...ConvexTeamConnectionFragment
    }
  }
`;

export const SetupConvexProjectResultFragmentNode = gql`
  fragment SetupConvexProjectResultFragment on SetupConvexProjectResult {
    convexDeploymentName
    convexDeploymentUrl
    deployKey
    convexProject {
      id
      ...ConvexProjectFragment
    }
  }
`;
