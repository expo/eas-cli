import gql from 'graphql-tag';

import { PostHogOrganizationConnection, PostHogProject } from '../generated';

export type PostHogOrganizationConnectionData = Pick<
  PostHogOrganizationConnection,
  | 'id'
  | 'posthogOrganizationIdentifier'
  | 'posthogOrganizationName'
  | 'posthogRegion'
  | 'createdAt'
  | 'updatedAt'
>;

// `state` is the website callback's correlator; the CLI only needs `url`, so it omits it.
export type PostHogPendingConnectionData = {
  url: string;
};

export type StartPostHogConnectionResult =
  | ({ __typename: 'PostHogOrganizationConnection' } & PostHogOrganizationConnectionData)
  | ({ __typename: 'PostHogPendingConnection' } & PostHogPendingConnectionData);

export type PostHogProjectData = Pick<
  PostHogProject,
  | 'id'
  | 'posthogProjectIdentifier'
  | 'posthogProjectName'
  | 'posthogProjectToken'
  | 'posthogHost'
  | 'createdAt'
  | 'updatedAt'
> & {
  posthogOrganizationConnection: PostHogOrganizationConnectionData;
};

export const PostHogOrganizationConnectionFragmentNode = gql`
  fragment PostHogOrganizationConnectionFragment on PostHogOrganizationConnection {
    id
    posthogOrganizationIdentifier
    posthogOrganizationName
    posthogRegion
    createdAt
    updatedAt
  }
`;

export const PostHogProjectFragmentNode = gql`
  fragment PostHogProjectFragment on PostHogProject {
    id
    posthogProjectIdentifier
    posthogProjectName
    posthogProjectToken
    posthogHost
    createdAt
    updatedAt
    posthogOrganizationConnection {
      id
      ...PostHogOrganizationConnectionFragment
    }
  }
`;
