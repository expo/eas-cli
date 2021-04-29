import gql from 'graphql-tag';

export const AndroidKeystoreFragmentNode = gql`
  fragment AndroidKeystoreFragment on AndroidKeystore {
    id
    type
    keystore
    keystorePassword
    keyAlias
    keyPassword
    md5CertificateFingerprint
    sha1CertificateFingerprint
    sha256CertificateFingerprint
    createdAt
    updatedAt
  }
`;
