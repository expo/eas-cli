import { print } from 'graphql';
import gql from 'graphql-tag';

import { UpdateFragmentNode } from './Update';
import { UpdateBranchBasicInfoFragmentNode } from './UpdateBranchBasicInfo';

export const UpdateBranchFragmentNode = gql`
  fragment UpdateBranchFragment on UpdateBranch {
    id
    ...UpdateBranchBasicInfoFragment
    updates(offset: 0, limit: 10) {
      id
      ...UpdateFragment
    }
  }
  ${print(UpdateFragmentNode)}
  ${print(UpdateBranchBasicInfoFragmentNode)}
`;
