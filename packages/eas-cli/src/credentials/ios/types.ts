import {
  CommonIosAppCredentialsFragment,
  IosAppBuildCredentialsFragment,
} from '../../graphql/generated';
import { Account } from '../../user/Account';

export interface App {
  account: Account;
  projectName: string;
}

export interface Target {
  targetName: string;
  bundleIdentifier: string;
  parentBundleIdentifier?: string;
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
