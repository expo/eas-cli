import { templateString } from '@expo/template-file';
import fs from 'fs-extra';

import { FastfileResignTemplate } from '../templates/FastfileResign';

import { TargetProvisioningProfiles } from './credentials/manager';

export async function createFastfileForResigningBuild({
  outputFile,
  ipaPath,
  signingIdentity,
  keychainPath,
  targetProvisioningProfiles,
}: {
  outputFile: string;
  ipaPath: string;
  signingIdentity: string;
  keychainPath: string;
  targetProvisioningProfiles: TargetProvisioningProfiles;
}): Promise<void> {
  const PROFILES: { BUNDLE_ID: string; PATH: string }[] = [];
  const targets = Object.keys(targetProvisioningProfiles);
  for (const target of targets) {
    const profile = targetProvisioningProfiles[target];
    PROFILES.push({
      BUNDLE_ID: profile.bundleIdentifier,
      PATH: profile.path,
    });
  }

  const output = templateString({
    input: FastfileResignTemplate,
    vars: {
      IPA_PATH: ipaPath,
      SIGNING_IDENTITY: signingIdentity,
      PROFILES,
      KEYCHAIN_PATH: keychainPath,
    },
    mustache: false,
  });

  await fs.writeFile(outputFile, output);
}
