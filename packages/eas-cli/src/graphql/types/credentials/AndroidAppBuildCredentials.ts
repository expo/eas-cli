import { print } from 'graphql';
import { gql } from 'graphql-tag';

import { AndroidKeystoreFragmentNode } from './AndroidKeystore.js';

export const AndroidAppBuildCredentialsFragmentNode = gql`
  fragment AndroidAppBuildCredentialsFragment on AndroidAppBuildCredentials {
    id
    isDefault
    isLegacy
    name
    androidKeystore {
      id
      ...AndroidKeystoreFragment
    }
  }
  ${print(AndroidKeystoreFragmentNode)}
`;
