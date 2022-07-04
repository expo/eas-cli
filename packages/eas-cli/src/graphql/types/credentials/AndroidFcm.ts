import { gql } from 'graphql-tag';

export const AndroidFcmFragmentNode = gql`
  fragment AndroidFcmFragment on AndroidFcm {
    id
    snippet {
      ... on FcmSnippetLegacy {
        firstFourCharacters
        lastFourCharacters
      }
      ... on FcmSnippetV1 {
        projectId
        keyId
        serviceAccountEmail
        clientId
      }
    }
    credential
    version
    createdAt
    updatedAt
  }
`;
