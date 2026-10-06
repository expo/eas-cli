import { print } from 'graphql';
import gql from 'graphql-tag';

export const UpdateFragmentNode = gql`
  fragment UpdateFragment on Update {
    id
    group
    message
    createdAt
    runtime {
      id
      version
    }
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
      ... on PartnerActor {
        username
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

/**
 * UpdateFragment plus the stored file URLs.
 *
 * Each URL is signed on demand by the server, which is not free, so only query this where the
 * URLs are actually shown. List queries should use UpdateFragment.
 */
export const UpdateWithFileUrlsFragmentNode = gql`
  fragment UpdateWithFileUrlsFragment on Update {
    id
    ...UpdateFragment
    assetMapUrl
    sourceMapUrl
  }
  ${print(UpdateFragmentNode)}
`;
