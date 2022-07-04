import { JSONObject } from '@expo/json-file';

import {
  CommonIosAppCredentialsFragment,
  IosAppBuildCredentialsFragment,
} from '../../graphql/generated.js';
import { Account } from '../../user/Account.js';

export interface App {
  account: Account;
  projectName: string;
}

export interface Target {
  targetName: string;
  buildConfiguration?: string;
  bundleIdentifier: string;
  parentBundleIdentifier?: string;
  entitlements: JSONObject;
}

export interface TargetCredentials {
  distributionCertificate: {
    certificateP12: string;
    certificatePassword: string;
  };
  provisioningProfile: string;
}

export type IosCredentials = Record<string, TargetCredentials>;

export type IosAppBuildCredentialsMap = Record<string, IosAppBuildCredentialsFragment>;
export type IosAppCredentialsMap = Record<string, CommonIosAppCredentialsFragment | null>;
