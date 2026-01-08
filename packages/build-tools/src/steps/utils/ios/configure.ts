import path from 'path';

import { IOSConfig } from '@expo/config-plugins';
import uniq from 'lodash/uniq';
import fs from 'fs-extra';
import plist from '@expo/plist';
import { bunyan } from '@expo/logger';

import { Credentials } from './credentials/manager';

export async function configureCredentialsAsync(
  logger: bunyan,
  workingDir: string,
  {
    credentials,
    buildConfiguration,
  }: {
    credentials: Credentials;
    buildConfiguration: string;
  }
): Promise<void> {
  const targetNames = Object.keys(credentials.targetProvisioningProfiles);
  for (const targetName of targetNames) {
    const profile = credentials.targetProvisioningProfiles[targetName];
    logger.info(
      `Assigning provisioning profile '${profile.name}' (Apple Team ID: ${profile.teamId}) to target '${targetName}'`
    );
    IOSConfig.ProvisioningProfile.setProvisioningProfileForPbxproj(workingDir, {
      targetName,
      profileName: profile.name,
      appleTeamId: profile.teamId,
      buildConfiguration,
    });
  }
}

export async function updateVersionsAsync(
  logger: bunyan,
  workingDir: string,
  {
    buildNumber,
    appVersion,
  }: {
    buildNumber?: string;
    appVersion?: string;
  },
  {
    targetNames,
    buildConfiguration,
  }: {
    targetNames: string[];
    buildConfiguration: string;
  }
): Promise<void> {
  const project = IOSConfig.XcodeUtils.getPbxproj(workingDir);
  const iosDir = path.join(workingDir, 'ios');

  const infoPlistPaths: string[] = [];
  for (const targetName of targetNames) {
    const xcBuildConfiguration = IOSConfig.Target.getXCBuildConfigurationFromPbxproj(project, {
      targetName,
      buildConfiguration,
    });
    const infoPlist = xcBuildConfiguration.buildSettings.INFOPLIST_FILE;
    if (infoPlist) {
      const evaluatedInfoPlistPath = trimQuotes(
        evaluateTemplateString(infoPlist, {
          SRCROOT: iosDir,
        })
      );
      const absolutePath = path.isAbsolute(evaluatedInfoPlistPath)
        ? evaluatedInfoPlistPath
        : path.join(iosDir, evaluatedInfoPlistPath);
      infoPlistPaths.push(path.normalize(absolutePath));
    }
  }
  const uniqueInfoPlistPaths = uniq(infoPlistPaths);
  for (const infoPlistPath of uniqueInfoPlistPaths) {
    logger.info(`Updating versions in ${infoPlistPath}`);
    const infoPlistRaw = await fs.readFile(infoPlistPath, 'utf-8');
    const infoPlist = plist.parse(infoPlistRaw) as IOSConfig.InfoPlist;
    if (buildNumber) {
      infoPlist.CFBundleVersion = buildNumber;
    }
    if (appVersion) {
      infoPlist.CFBundleShortVersionString = appVersion;
    }
    await fs.writeFile(infoPlistPath, plist.build(infoPlist));
  }
}

function trimQuotes(s: string): string {
  return s?.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

export function evaluateTemplateString(s: string, buildSettings: Record<string, string>): string {
  // necessary because buildSettings might be XCBuildConfiguration['buildSettings'] which is not a plain object
  const vars = { ...buildSettings };
  return s.replace(/\$\((\w+)\)/g, (match, key) => {
    if (vars.hasOwnProperty(key)) {
      const value = String(vars[key]);
      return trimQuotes(value);
    } else {
      return match;
    }
  });
}
