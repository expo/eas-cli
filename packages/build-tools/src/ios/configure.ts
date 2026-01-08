import path from 'path';

import { IOSConfig } from '@expo/config-plugins';
import { Ios } from '@expo/eas-build-job';
import uniq from 'lodash/uniq';
import fs from 'fs-extra';
import plist from '@expo/plist';

import { BuildContext } from '../context';

import { Credentials } from './credentials/manager';

async function configureXcodeProject(
  ctx: BuildContext<Ios.Job>,
  {
    credentials,
    buildConfiguration,
  }: {
    credentials: Credentials;
    buildConfiguration: string;
  }
): Promise<void> {
  ctx.logger.info('Configuring Xcode project');
  await configureCredentialsAsync(ctx, {
    credentials,
    buildConfiguration,
  });
  const { version } = ctx.job;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  if (version?.appVersion || version?.buildNumber) {
    await updateVersionsAsync(ctx, {
      targetNames: Object.keys(credentials.targetProvisioningProfiles),
      buildConfiguration,
    });
  }
}

async function configureCredentialsAsync(
  ctx: BuildContext<Ios.Job>,
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
    ctx.logger.info(
      `Assigning provisioning profile '${profile.name}' (Apple Team ID: ${profile.teamId}) to target '${targetName}'`
    );
    IOSConfig.ProvisioningProfile.setProvisioningProfileForPbxproj(
      ctx.getReactNativeProjectDirectory(),
      {
        targetName,
        profileName: profile.name,
        appleTeamId: profile.teamId,
        buildConfiguration,
      }
    );
  }
}

async function updateVersionsAsync(
  ctx: BuildContext<Ios.Job>,
  {
    targetNames,
    buildConfiguration,
  }: {
    targetNames: string[];
    buildConfiguration: string;
  }
): Promise<void> {
  const project = IOSConfig.XcodeUtils.getPbxproj(ctx.getReactNativeProjectDirectory());
  const iosDir = path.join(ctx.getReactNativeProjectDirectory(), 'ios');

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
    ctx.logger.info(`Updating versions in ${infoPlistPath}`);
    const infoPlistRaw = await fs.readFile(infoPlistPath, 'utf-8');
    const infoPlist = plist.parse(infoPlistRaw) as IOSConfig.InfoPlist;
    if (ctx.job.version?.buildNumber) {
      infoPlist.CFBundleVersion = ctx.job.version?.buildNumber;
    }
    if (ctx.job.version?.appVersion) {
      infoPlist.CFBundleShortVersionString = ctx.job.version?.appVersion;
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

export { configureXcodeProject };
