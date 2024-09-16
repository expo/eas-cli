import gql from 'graphql-tag';

export const WorkerDeploymentAliasFragmentNode = gql`
  fragment WorkerDeploymentAliasFragment on WorkerDeploymentAlias {
    id
    aliasName
    url
  }
`;
