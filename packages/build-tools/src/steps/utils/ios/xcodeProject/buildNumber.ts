import { IOSConfig } from '@expo/config-plugins';
import { bunyan } from '@expo/logger';
import plist from '@expo/plist';
import { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import path from 'node:path';

import { XcodeTarget, openXcodeProject, overrideTargetBuildSettings } from './pbxproj';

type BuildSettings = Record<string, string>;
type InfoPlistByPath = Map<string, Record<string, unknown>>;

export interface ProjectVersion {
  buildNumber?: string;
  shortVersion?: string;
}

export async function readEditableInfoPlistsAsync(
  buildSettingsOfTargets: BuildSettings[],
  { env, logger }: { env: BuildStepEnv; logger: bunyan }
): Promise<InfoPlistByPath> {
  const isPreprocessedByPath = new Map<string, boolean>();
  for (const buildSettings of buildSettingsOfTargets) {
    const infoPlistPath = resolveInfoPlistPath(buildSettings);
    if (infoPlistPath) {
      isPreprocessedByPath.set(
        infoPlistPath,
        isPreprocessedByPath.get(infoPlistPath) === true ||
          isEnabled(buildSettings.INFOPLIST_PREPROCESS)
      );
    }
  }
  const editableInfoPlistByPath: InfoPlistByPath = new Map();
  await Promise.all(
    [...isPreprocessedByPath].map(async ([infoPlistPath, isPreprocessed]) => {
      if (isPreprocessed) {
        logger.warn(
          `Xcode preprocesses "${infoPlistPath}" (INFOPLIST_PREPROCESS), so EAS neither reads nor sets the build number in that file.`
        );
        return;
      }
      try {
        const { stdout } = await spawn('plutil', ['-convert', 'xml1', '-o', '-', infoPlistPath], {
          stdio: 'pipe',
          env,
        });
        editableInfoPlistByPath.set(infoPlistPath, plist.parse(stdout));
      } catch (err) {
        logger.warn(
          { err },
          `EAS could not read "${infoPlistPath}" as a property list, so it neither reads nor sets the build number in that file.`
        );
      }
    })
  );
  return editableInfoPlistByPath;
}

export function readProjectVersion(
  buildSettings: BuildSettings,
  editableInfoPlistByPath: InfoPlistByPath
): ProjectVersion {
  const infoPlistPath = resolveInfoPlistPath(buildSettings);
  const infoPlist = infoPlistPath ? editableInfoPlistByPath.get(infoPlistPath) : undefined;
  // Xcode 26.3 and 27.2 take CFBundleVersion of a generated Info.plist from the build setting and
  // drop the value of the file; they take it of any other Info.plist from the file.
  if (isEnabled(buildSettings.GENERATE_INFOPLIST_FILE) || !infoPlist) {
    return {
      buildNumber: buildSettings.CURRENT_PROJECT_VERSION || undefined,
      shortVersion: buildSettings.MARKETING_VERSION || undefined,
    };
  }
  return {
    buildNumber: expandBuildSettings(infoPlist.CFBundleVersion, buildSettings),
    shortVersion: expandBuildSettings(infoPlist.CFBundleShortVersionString, buildSettings),
  };
}

export async function writeBuildNumberAsync({
  xcodeprojPath,
  buildConfiguration,
  targets,
  editableInfoPlistPaths,
  buildNumber,
  env,
  logger,
}: {
  xcodeprojPath: string;
  buildConfiguration: string;
  targets: XcodeTarget[];
  editableInfoPlistPaths: string[];
  buildNumber: string;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  const project = openXcodeProject(xcodeprojPath);
  for (const target of targets) {
    overrideTargetBuildSettings(project, {
      target,
      buildConfiguration,
      overrides: { CURRENT_PROJECT_VERSION: buildNumber },
    });
  }
  await Promise.all([
    fs.promises.writeFile(project.filepath, project.writeSync()),
    ...editableInfoPlistPaths.map(async infoPlistPath => {
      try {
        await spawn(
          'plutil',
          ['-replace', 'CFBundleVersion', '-string', buildNumber, infoPlistPath],
          { stdio: 'pipe', env }
        );
      } catch (err) {
        logger.warn({ err }, `EAS could not set the build number in "${infoPlistPath}".`);
      }
    }),
  ]);
}

// Xcode 27.2 reads a boolean build setting as true when its first character is y, Y, t, T or 1 to 9.
function isEnabled(buildSetting: string | undefined): boolean {
  return /^[yYtT1-9]/.test(buildSetting ?? '');
}

function resolveInfoPlistPath(buildSettings: BuildSettings): string | undefined {
  return buildSettings.INFOPLIST_FILE
    ? path.resolve(buildSettings.SRCROOT, buildSettings.INFOPLIST_FILE)
    : undefined;
}

function expandBuildSettings(value: unknown, buildSettings: BuildSettings): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  // An Info.plist file refers to a build setting as $(NAME) or ${NAME}; resolveXcodeBuildSetting
  // expands only the first form.
  return (
    IOSConfig.XcodeUtils.resolveXcodeBuildSetting(
      String(value).replace(/\$\{([^{}]*)\}/g, '$($1)'),
      buildSetting => buildSettings[buildSetting]
    ) || undefined
  );
}
