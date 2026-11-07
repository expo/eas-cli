import { IOSConfig } from '@expo/config-plugins';
import resolveFrom from 'resolve-from';

// Prebuild names the Xcode target with the project's own config-plugins, and the sanitizer changed
// in SDK 58 ('Fotógrafos' -> 'Fotografos', was 'Fotgrafos'), so the bundled copy can disagree.
export function sanitizedNameForProject(projectDir: string, name: string): string {
  const projectConfigPluginsPath = resolveFrom.silent(projectDir, 'expo/config-plugins');
  const projectSanitizedName: ((name: string) => string) | undefined = projectConfigPluginsPath
    ? require(projectConfigPluginsPath).IOSConfig?.XcodeUtils?.sanitizedName
    : undefined;
  return (projectSanitizedName ?? IOSConfig.XcodeUtils.sanitizedName)(name);
}
