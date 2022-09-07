import { print } from 'graphql';
import gql from 'graphql-tag';

import { UpdateFragmentNode } from './Update';

export const UpdateBranchFragmentNode = gql`
  fragment UpdateBranchFragment on UpdateBranch {
    id
    name
    updates(offset: 0, limit: 10) {
      id
      ...UpdateFragment
    }
  }
  ${print(UpdateFragmentNode)}
`;
