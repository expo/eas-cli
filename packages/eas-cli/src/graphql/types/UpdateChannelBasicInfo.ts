import gql from 'graphql-tag';

export const UpdateChannelBasicInfoFragmentNode = gql`
  fragment UpdateChannelBasicInfoFragment on UpdateChannel {
    id
    name
    branchMapping
  }
`;
