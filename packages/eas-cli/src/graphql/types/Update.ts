import gql from 'graphql-tag';

export const UpdateFragmentNode = gql`
  fragment UpdateFragment on Update {
    id
    group
    message
    createdAt
    runtimeVersion
    platform
    manifestFragment
    isRollBackToEmbedded
    manifestPermalink
    gitCommitHash
    isGitWorkingTreeDirty
    environment
    actor {
      __typename
      id
      ... on UserActor {
        username
      }
      ... on Robot {
        firstName
      }
    }
    branch {
      id
      name
    }
    codeSigningInfo {
      keyid
      sig
      alg
    }
    rolloutPercentage
    rolloutControlUpdate {
      id
      group
    }
    fingerprint {
      id
      hash
      debugInfoUrl
      source {
        type
        bucketKey
        isDebugFingerprint
      }
    }
    manifestHostOverride
    assetHostOverride
  }
`;
