import { AndroidConfig } from '@expo/config-plugins';
import fs from 'fs-extra';
import g2js from 'gradle-to-js/lib/parser';

// represents gradle command
// e.g. for `:app:buildExampleDebug` -> { moduleName: app, flavor: example, buildType: debug }
interface GradleCommand {
  moduleName?: string;
  flavor?: string;
  buildType?: string;
}

interface Config {
  applicationId?: string;
  applicationIdSuffix?: string; // unsupported value
  versionCode?: string;
  versionName?: string;
}

interface AppBuildGradle {
  android?: {
    defaultConfig?: Config;
    /**
     * If defined as `flavorDimensions = ['dimension1', 'dimension2']`,
     * this will be an array of strings (`['dimension1', 'dimension2']`).
     *
     * If defined as `flavorDimensions "dimension1", "dimension2"`,
     * this will be a string (`"dimension1", "dimension2"`).
     */
    flavorDimensions?: string | string[];
    productFlavors?: Record<string, Config>;
  };
}

export const DEFAULT_MODULE_NAME = 'app';

export async function getAppBuildGradleAsync(projectDir: string): Promise<AppBuildGradle> {
  const buildGradlePath = AndroidConfig.Paths.getAppBuildGradleFilePath(projectDir);
  const rawBuildGradle = await fs.readFile(buildGradlePath, 'utf8');

  // filter out any comments
  // when comments are present, gradle-to-js fails to parse the file
  const rawBuildGradleWithoutComments = rawBuildGradle
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');

  return await g2js.parseText(unwrapStringInterpolations(rawBuildGradleWithoutComments));
}

/**
 * gradle-to-js counts `{` and `}` without knowing about string literals, so the braces of a
 * Groovy string interpolation are treated as a block. When the interpolation contains a method
 * call, like `buildConfigField "String", "KEY", "\"${System.getenv("KEY")}\""`, the parser
 * skips one character too many and swallows the closing brace of the surrounding block. Every
 * entry that follows then ends up nested in the wrong place, which is why `android.productFlavors`
 * comes back as `undefined` for projects that use interpolated build config fields.
 *
 * Unwrapping the interpolations drops the braces and keeps their content. `[^{}]*` never matches
 * across a brace, so nested interpolations are unwrapped one level per pass.
 */
function unwrapStringInterpolations(buildGradle: string): string {
  let result = buildGradle;
  let previousResult;
  do {
    previousResult = result;
    result = result.replace(/\$\{([^{}]*)\}/g, '$$$1');
  } while (result !== previousResult);
  return result;
}

export function resolveConfigValue(
  buildGradle: AppBuildGradle,
  field: keyof Config,
  flavor?: string
): string | undefined {
  return (
    (flavor && buildGradle?.android?.productFlavors?.[flavor]?.[field]) ??
    buildGradle?.android?.defaultConfig?.[field]
  );
}

/**
 * Extract module name, buildType, and flavor from the gradle command.
 *
 * @param cmd can be any valid string that can be added after `./gradlew` call
 * e.g.
 *   - :app:buildDebug
 *   - app:buildDebug
 *   - buildDebug
 *   - buildDebug --console verbose
 * @param buildGradle is used to verify correct casing of the first letter in
 * the flavor name
 **/
export function parseGradleCommand(cmd: string, buildGradle: AppBuildGradle): GradleCommand {
  const flavorDimensions =
    typeof buildGradle.android?.flavorDimensions === 'string'
      ? buildGradle.android.flavorDimensions.split(',')
      : buildGradle.android?.flavorDimensions;
  const hasFlavorDimensions = flavorDimensions && flavorDimensions.length > 1;
  if (hasFlavorDimensions) {
    throw new Error('flavorDimensions in build.gradle are not supported yet');
  }
  const flavors = new Set(Object.keys(buildGradle?.android?.productFlavors ?? {}));

  // remove any params specified after command name
  const [withoutParams] = cmd.split(' ');

  // remove leading :
  const rawCmd = withoutParams.startsWith(':') ? withoutParams.slice(1) : withoutParams;

  // separate moduleName and rest of the definition
  const splitCmd = rawCmd.split(':');
  const [moduleName, taskName] =
    splitCmd.length > 1 ? [splitCmd[0], splitCmd[1]] : [undefined, splitCmd[0]];

  const matchResult = taskName.match(/(build|bundle|assemble|package)(.*)([A-Z][a-z]+)/);
  if (!matchResult) {
    throw new Error(`Failed to parse gradle command: ${cmd}`);
  }
  let flavor: string | undefined;
  if (matchResult[2]) {
    const [firstLetter, rest] = [matchResult[2].slice(0, 1), matchResult[2].slice(1)];
    // first letter casing is not known based on gradle task name
    // so we need to check both options
    const flavorOptions = [
      firstLetter.toLowerCase().concat(rest),
      firstLetter.toUpperCase().concat(rest),
    ];
    flavorOptions.forEach(option => {
      if (flavors.has(option)) {
        flavor = option;
      }
    });
    if (!flavor) {
      throw new Error(`flavor ${firstLetter.toLowerCase().concat(rest)} is not defined`);
    }
  }

  const buildType = matchResult[3]
    ? matchResult[3].charAt(0).toLowerCase() + matchResult[3].slice(1)
    : undefined;

  return {
    moduleName,
    flavor,
    buildType,
  };
}
