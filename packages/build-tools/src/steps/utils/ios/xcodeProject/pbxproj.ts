import { IOSConfig } from '@expo/config-plugins';
import { UserError } from '@expo/eas-build-job';
import path from 'path';
import {
  PBXNativeTarget,
  XCBuildConfiguration,
  XcodeProject,
  project as parseProject,
} from 'xcode';
import { z } from 'zod';

const { TargetType, getNativeTargets, isTargetOfType } = IOSConfig.Target;
const { getBuildConfigurationsForListId, unquote } = IOSConfig.XcodeUtils;

export interface XcodeTarget {
  id: string;
  name: string;
}

export interface XcodeTargetWithBundleIdentifier extends XcodeTarget {
  bundleIdentifier: string;
}

export const XcodeTargetsWithBundleIdentifierZ = z.array(
  z.object({ id: z.string(), name: z.string(), bundleIdentifier: z.string() })
);

export function openXcodeProject(xcodeprojPath: string): XcodeProject {
  const pbxprojPath = path.join(xcodeprojPath, 'project.pbxproj');
  const project = parseProject(pbxprojPath);
  try {
    project.parseSync();
  } catch (err: any) {
    throw new UserError(
      'NATIVE_XCODE_PROJECT_UNREADABLE',
      `Failed to read the Xcode project file "${pbxprojPath}": ${err.message}. Check that the file is committed and that Xcode can open the project.`,
      { cause: err }
    );
  }
  return project;
}

export function findApplicationTargetById(
  project: XcodeProject,
  targetId: string
): XcodeTarget | undefined {
  const target = findNativeTarget(project, targetId);
  return target && isTargetOfType(target, TargetType.APPLICATION)
    ? { id: targetId, name: unquote(target.name) }
    : undefined;
}

export function findDependencyTargets(project: XcodeProject, targetId: string): XcodeTarget[] {
  const dependencyTargetById = new Map<string, XcodeTarget>();
  const visit = (parentTargetId: string): void => {
    const dependencies: { value: string }[] =
      findNativeTarget(project, parentTargetId)?.dependencies ?? [];
    for (const { value: dependencyId } of dependencies) {
      const dependency = project.getPBXGroupByKeyAndType(dependencyId, 'PBXTargetDependency') as {
        target?: string;
      };
      const [id, target] =
        getNativeTargets(project).find(
          ([nativeTargetId]) => nativeTargetId === dependency.target
        ) ?? [];
      if (!id || !target || dependencyTargetById.has(id)) {
        continue;
      }
      dependencyTargetById.set(id, { id, name: unquote(target.name) });
      visit(id);
    }
  };
  visit(targetId);
  return [...dependencyTargetById.values()];
}

export function getBuildConfigurations(
  project: XcodeProject,
  targetId: string
): XCBuildConfiguration[] {
  const target = findNativeTarget(project, targetId);
  return target
    ? getBuildConfigurationsForListId(project, target.buildConfigurationList).map(
        ([, buildConfiguration]) => buildConfiguration
      )
    : [];
}

function findNativeTarget(project: XcodeProject, targetId: string): PBXNativeTarget | undefined {
  return getNativeTargets(project).find(([id]) => id === targetId)?.[1];
}
