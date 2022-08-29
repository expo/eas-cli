import gql from 'graphql-tag';

export const StatuspageServiceFragmentNode = gql`
  fragment StatuspageServiceFragment on StatuspageService {
    id
    name
    status
    incidents {
      id
      status
      name
      impact
      shortlink
    }
  }
`;
