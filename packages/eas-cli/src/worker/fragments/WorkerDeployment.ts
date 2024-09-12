import gql from 'graphql-tag';

export const WorkerDeploymentFragmentNode = gql`
  fragment WorkerDeploymentFragment on WorkerDeployment {
    id
    url
    deploymentIdentifier
    deploymentDomain
    createdAt
  }
`;
