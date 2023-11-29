import gql from 'graphql-tag';

export const AccountFragmentNode = gql`
  fragment AccountFragment on Account {
    id
    name
    ownerUserActor {
      id
      username
    }
    users {
      actor {
        id
      }
      role
    }
  }
`;
