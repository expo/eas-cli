import { quoteAndroidShellCommand } from '@expo/eas-build-job';
import { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

const MAIN_ACTION = 'android.intent.action.MAIN';
const LAUNCHER_CATEGORY = 'android.intent.category.LAUNCHER';
const LEANBACK_LAUNCHER_CATEGORY = 'android.intent.category.LEANBACK_LAUNCHER';

/**
 * Extracts a standard `launchable-activity` name from `aapt2 dump badging` output.
 */
export function parseLaunchableActivityFromBadging(badgingStdout: string): string | undefined {
  return badgingStdout.match(/(?:^|\r?\n)launchable-activity: name='([^']+)'/)?.[1];
}

/**
 * Extracts a TV `leanback-launchable-activity` name from `aapt2 dump badging` output.
 */
export function parseLeanbackLaunchableActivityFromBadging(
  badgingStdout: string
): string | undefined {
  return badgingStdout.match(/(?:^|\r?\n)leanback-launchable-activity: name='([^']+)'/)?.[1];
}

/**
 * Parses a component name (`<package>/<activity>`) for `applicationIdentifier`
 * from `cmd package resolve-activity --brief` or `query-activities --brief` output.
 * Expands relative `.Activity` names against `applicationIdentifier`.
 */
export function parseResolvedAndroidActivity(
  stdout: string,
  applicationIdentifier: string
): string | undefined {
  return parseResolveActivityOutput(stdout, applicationIdentifier).activityName;
}

/**
 * Resolves the launcher activity for an installed Android package on the booted
 * emulator via Android's package manager. Handles apps where `aapt2 dump badging`
 * omits `launchable-activity` (for example `<activity-alias>` launcher entries,
 * multi-launcher manifests, or Android TV Leanback launchers).
 */
export async function resolveAndroidLauncherActivityAsync({
  applicationIdentifier,
  user,
  env,
}: {
  applicationIdentifier: string;
  user?: string;
  env: BuildStepEnv;
}): Promise<string | undefined> {
  const launcherActivity = await resolveCategoryActivityAsync({
    applicationIdentifier,
    category: LAUNCHER_CATEGORY,
    user,
    env,
  });
  if (launcherActivity) {
    return launcherActivity;
  }

  return await resolveCategoryActivityAsync({
    applicationIdentifier,
    category: LEANBACK_LAUNCHER_CATEGORY,
    user,
    env,
  });
}

async function resolveCategoryActivityAsync({
  applicationIdentifier,
  category,
  user,
  env,
}: {
  applicationIdentifier: string;
  category: string;
  user?: string;
  env: BuildStepEnv;
}): Promise<string | undefined> {
  const userArgs = user !== undefined ? ['--user', user] : [];
  const { stdout } = await spawn(
    'adb',
    [
      'shell',
      ...quoteAndroidShellCommand([
        'cmd',
        'package',
        'resolve-activity',
        '--brief',
        ...userArgs,
        '-a',
        MAIN_ACTION,
        '-c',
        category,
        '-p',
        applicationIdentifier,
      ]),
    ],
    {
      stdio: 'pipe',
      env,
    }
  );
  const parsed = parseResolveActivityOutput(stdout, applicationIdentifier);
  if (parsed.activityName) {
    return parsed.activityName;
  }
  if (!parsed.hasForeignComponentMatch) {
    return undefined;
  }

  // Multiple matching launcher activities resolve to a system resolver (such as
  // android/com.android.internal.app.ResolverActivity or an OEM/Automotive resolver);
  // fall back to `query-activities` to pick the first matching activity in the package.
  const queryResult = await spawn(
    'adb',
    [
      'shell',
      ...quoteAndroidShellCommand([
        'cmd',
        'package',
        'query-activities',
        '--brief',
        ...userArgs,
        '-a',
        MAIN_ACTION,
        '-c',
        category,
        '-p',
        applicationIdentifier,
      ]),
    ],
    {
      stdio: 'pipe',
      env,
    }
  );
  return parseResolveActivityOutput(queryResult.stdout, applicationIdentifier).activityName;
}

function parseResolveActivityOutput(
  stdout: string,
  applicationIdentifier: string
): { activityName?: string; hasForeignComponentMatch: boolean } {
  let hasForeignComponentMatch = false;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /\s/.test(line)) {
      continue;
    }
    const separatorIndex = line.indexOf('/');
    if (
      separatorIndex <= 0 ||
      separatorIndex !== line.lastIndexOf('/') ||
      separatorIndex === line.length - 1
    ) {
      continue;
    }
    const packageName = line.slice(0, separatorIndex);
    const rawActivity = line.slice(separatorIndex + 1);
    if (rawActivity === '.') {
      continue;
    }
    if (packageName === applicationIdentifier) {
      const activityName = rawActivity.startsWith('.')
        ? `${applicationIdentifier}${rawActivity}`
        : rawActivity;
      return { activityName, hasForeignComponentMatch: false };
    }
    if (/^[a-zA-Z0-9_.]+$/.test(packageName)) {
      hasForeignComponentMatch = true;
    }
  }
  return { hasForeignComponentMatch };
}
