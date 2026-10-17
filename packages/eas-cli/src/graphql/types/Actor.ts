/* eslint-disable graphql/required-fields */
import { print } from 'graphql';
import gql from 'graphql-tag';
import { AccountFragmentNode } from './Account';

export const MeActorFragmentNode = gql`
  ${print(AccountFragmentNode)}

  fragment MeActorFragment on Actor {
    __typename
    id
    ... on User {
      email
    }
    ... on UserActor {
      username
    }
    ... on Robot {
      firstName
    }
    accounts {
      id
      ...AccountFragment
    }
    ... on PartnerActor {
      username
    }
    featureGates
    isExpoAdmin
  }
`;
