import { print } from 'graphql';
import gql from 'graphql-tag';

import { UpdateFragmentNode } from './Update';

export const UpdateBranchWithCurrentGroupFragmentNode = gql`
  fragment UpdateBranchWithCurrentGroupFragment on UpdateBranch {
    id
    name
    updateGroups(offset: 0, limit: 1) {
      id
      ...UpdateFragment
    }
  }
  ${print(UpdateFragmentNode)}
`;
