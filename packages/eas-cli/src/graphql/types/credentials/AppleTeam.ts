import gql from 'graphql-tag';

export const AppleTeamFragmentDoc = gql`
  fragment AppleTeamFragment on AppleTeam {
    id
    appleTeamIdentifier
    appleTeamName
  }
`;
