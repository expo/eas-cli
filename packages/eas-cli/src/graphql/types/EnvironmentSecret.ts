import gql from 'graphql-tag';

import { EnvironmentSecretType } from '../generated';

export const EnvironmentSecretFragmentNode = gql`
  fragment EnvironmentSecretFragment on EnvironmentSecret {
    id
    name
    type
    createdAt
  }
`;

export enum SecretType {
  STRING = 'string',
  FILE = 'file',
}

export function maybeGetSecretType(secretTypeString: string | undefined): SecretType | undefined {
  if (!secretTypeString) {
    return undefined;
  }
  return Object.values(SecretType).find(secretType => secretType === secretTypeString);
}

export const SecretTypeToEnvironmentSecretType: Record<SecretType, EnvironmentSecretType> = {
  [SecretType.STRING]: EnvironmentSecretType.String,
  [SecretType.FILE]: EnvironmentSecretType.FileBase64,
};

export const EnvironmentSecretTypeToSecretType: Record<EnvironmentSecretType, SecretType> = {
  [EnvironmentSecretType.String]: SecretType.STRING,
  [EnvironmentSecretType.FileBase64]: SecretType.FILE,
};
