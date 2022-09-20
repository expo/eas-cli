import { JSONObject } from '@expo/json-file';
import type { XCBuildConfiguration } from 'xcode';

import {
  AccountFragment,
  CommonIosAppCredentialsFragment,
  IosAppBuildCredentialsFragment,
} from '../../graphql/generated';

export interface App {
  account: AccountFragment;
  projectName: string;
}

export interface Target {
  targetName: string;
  buildConfiguration?: string;
  bundleIdentifier: string;
  parentBundleIdentifier?: string;
  entitlements: JSONObject;
  buildSettings?: XCBuildConfiguration['buildSettings'];
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
