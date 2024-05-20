import gql from 'graphql-tag';

export const AppleTeamFragmentNode = gql`
  fragment AppleTeamFragment on AppleTeam {
    id
    appleTeamIdentifier
    appleTeamName
    appleTeamType
  }
`;
