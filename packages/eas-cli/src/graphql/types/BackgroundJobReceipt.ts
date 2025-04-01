import gql from 'graphql-tag';

export const BackgroundJobReceiptNode = gql`
  fragment BackgroundJobReceiptData on BackgroundJobReceipt {
    id
    state
    tries
    willRetry
    resultId
    resultType
    resultData
    errorCode
    errorMessage
    createdAt
    updatedAt
  }
`;
