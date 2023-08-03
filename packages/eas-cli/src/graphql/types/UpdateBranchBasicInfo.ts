import gql from 'graphql-tag';

export const UpdateBranchBasicInfoFragmentNode = gql`
  fragment UpdateBranchBasicInfoFragment on UpdateBranch {
    id
    name
  }
`;
