import { UserRole } from '@expo/apple-utils';

import {
  DistributionCertificate,
  ProvisioningProfile,
  PushKey,
} from './appstore/Credentials.types';
import { findP12CertSerialNumber } from './utils/p12Certificate';
import { readAppleTeam as readAppleTeamFromProvisioningProfile } from './utils/provisioningProfile';
import { AppleDevice } from '../../graphql/generated';
import Log from '../../log';
import { CredentialSchema } from '../utils/promptForCredentials';

export interface AppLookupParams {
  accountName: string;
  projectName: string;
  bundleIdentifier: string;
}

export function getAppLookupParams(
  experienceName: string,
  bundleIdentifier: string
): AppLookupParams {
  const matchedExperienceName = experienceName.match(/@(.+)\/(.+)/);
  if (!matchedExperienceName || matchedExperienceName.length < 3) {
    throw new Error('invalid experience name');
  }
  return {
    accountName: matchedExperienceName[1],
    projectName: matchedExperienceName[2],
    bundleIdentifier,
  };
}

export interface IosCredentials {
  appCredentials: IosAppCredentials[];
  userCredentials: (IosPushCredentials | IosDistCredentials)[];
}

export interface IosAppCredentials {
  experienceName: string;
  bundleIdentifier: string;

  pushCredentialsId?: number;
  distCredentialsId?: number;
  credentials: {
    provisioningProfileId?: string;
    provisioningProfile?: string;

    // for adhoc provisioning profiles
    devices?: AppleDevice[];

    teamId?: string;
    teamName?: string;
    // legacy pushCert
    pushId?: string;
    pushP12?: string;
    pushPassword?: string;
  };
}

export interface IosPushCredentials extends PushKey {
  id: string;
  type: 'push-key';
}

export interface IosDistCredentials extends DistributionCertificate {
  id: string;
  type: 'dist-cert';
}

export const distributionCertificateSchema: CredentialSchema<DistributionCertificate> = {
  name: 'Apple Distribution Certificate',
  questions: [
    {
      field: 'certP12',
      question: 'Path to P12 file:',
      type: 'file',
      base64Encode: true,
    },
    {
      field: 'certPassword',
      type: 'password',
      question: 'P12 password:',
    },
    {
      field: 'teamId',
      type: 'string',
      question: 'Apple Team ID:',
    },
  ],
  transformResultAsync: async answers => {
    try {
      const distCertSerialNumber = findP12CertSerialNumber(answers.certP12!, answers.certPassword!);
      return { ...answers, distCertSerialNumber } as DistributionCertificate;
    } catch (error) {
      Log.warn('Unable to access certificate serial number.');
      Log.warn('Make sure that certificate and password are correct.');
      Log.warn(error);
    }
    return answers as DistributionCertificate;
  },
};

export type MinimalAscApiKey = {
  keyP8: string;
  keyId: string;
  issuerId: string;
  teamId?: string;
  teamName?: string;
  roles?: UserRole[];
  name?: string;
};

export interface AscApiKeyPath {
  keyP8Path: string;
  keyId: string;
  issuerId: string;
}

export const ascApiKeyIdSchema: CredentialSchema<Pick<MinimalAscApiKey, 'keyId'>> = {
  name: 'App Store Connect API Key',
  questions: [
    {
      field: 'keyId',
      type: 'string',
      question: 'Key ID:',
    },
  ],
};

export const ascApiKeyIssuerIdSchema: CredentialSchema<Pick<MinimalAscApiKey, 'issuerId'>> = {
  name: 'App Store Connect API Key',
  questions: [
    {
      field: 'issuerId',
      type: 'string',
      question: 'Issuer ID:',
    },
  ],
};

export const pushKeySchema: CredentialSchema<PushKey> = {
  name: 'Apple Push Notifications service key',
  questions: [
    {
      field: 'apnsKeyP8',
      type: 'file',
      question: 'Path to P8 file:',
    },
    {
      field: 'apnsKeyId',
      type: 'string',
      question: 'Key ID:',
    },
    { field: 'teamId', type: 'string', question: 'Apple Team ID:' },
  ],
};

export const provisioningProfileSchema: CredentialSchema<ProvisioningProfile> = {
  name: 'Apple Provisioning Profile',
  questions: [
    {
      field: 'provisioningProfile',
      type: 'file',
      question: 'Path to .mobileprovision file:',
      base64Encode: true,
    },
  ],
  transformResultAsync: async answers => {
    return {
      ...answers,
      ...readAppleTeamFromProvisioningProfile(answers.provisioningProfile!),
    } as ProvisioningProfile;
  },
};
