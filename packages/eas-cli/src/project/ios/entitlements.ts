import { ExportedConfig, IOSConfig, compileModsAsync } from '@expo/config-plugins';
import { JSONObject } from '@expo/json-file';
import { getPrebuildConfigAsync } from '@expo/prebuild-config';

import Log from '../../log';
import Sentry from '../../sentry';
import { spawnExpoCommand } from '../../utils/expoCli';
import { readPlistAsync } from '../../utils/plist';
import { Client } from '../../vcs/vcs';
import { isExpoInstalled } from '../projectUtils';
import { hasIgnoredIosProjectAsync } from '../workflow';

interface Target {
  buildConfiguration?: string;
  targetName: string;
}

export async function getManagedApplicationTargetEntitlementsAsync(
  projectDir: string,
  env: Record<string, string>,
  vcsClient: Client
): Promise<JSONObject> {
  let expoConfigError: any;
  if (isExpoInstalled(projectDir)) {
    try {
      const { stdout } = await spawnExpoCommand(
        projectDir,
        ['config', '--json', '--type', 'introspect'],
        {
          env: {
            ...env,
            EXPO_NO_DOTENV: '1',
          },
        }
      );
      const expWithMods: ExportedConfig = JSON.parse(stdout);
      return expWithMods.ios?.entitlements ?? {};
    } catch (error: any) {
      try {
        Sentry.withScope(scope => {
          if (process.env.EAS_BUILD_PROJECT_ID) {
            scope.setTag('app_id', process.env.EAS_BUILD_PROJECT_ID);
          }
          if (process.env.EAS_BUILD_ID) {
            scope.setTag('build_id', process.env.EAS_BUILD_ID);
          }
          scope.setTag('config_resolution', 'ios_entitlements_introspection');
          scope.setExtra(
            'expo_config_command_error',
            JSON.stringify({
              message: error.message,
              output: error.output,
              signal: error.signal,
              status: error.status,
              stderr: error.stderr,
              stdout: error.stdout,
            })
          );
          Sentry.captureMessage('iOS entitlements config fallback', 'error');
        });
      } catch {
        // do nothing
      }
      expoConfigError = error;
      Log.warn(
        `Failed to read the app config from the project using the local Expo CLI: ${formatError(error)}`
      );
      Log.warn('Falling back to the version of "@expo/config" shipped with the EAS CLI.');
    }
  }

  try {
    return await resolveManagedApplicationTargetEntitlementsWithBundledConfigAsync(
      projectDir,
      env,
      vcsClient
    );
  } catch (fallbackError: any) {
    if (expoConfigError) {
      throw new Error(
        `Failed to resolve iOS entitlements from Expo config. The local Expo CLI failed with: ${formatError(
          expoConfigError
        )}. The bundled config fallback also failed with: ${formatError(fallbackError)}`,
        { cause: fallbackError }
      );
    }
    throw new Error(
      `Failed to resolve iOS entitlements from Expo config using the bundled config fallback: ${formatError(
        fallbackError
      )}`,
      { cause: fallbackError }
    );
  }
}

async function resolveManagedApplicationTargetEntitlementsWithBundledConfigAsync(
  projectDir: string,
  env: Record<string, string>,
  vcsClient: Client
): Promise<JSONObject> {
  const originalProcessEnv = process.env;
  try {
    process.env = {
      ...process.env,
      ...env,
    };
    const { exp } = await getPrebuildConfigAsync(projectDir, { platforms: ['ios'] });
    const expWithMods = await compileModsAsync(exp, {
      projectRoot: projectDir,
      platforms: ['ios'],
      introspect: true,
      ignoreExistingNativeFiles: await hasIgnoredIosProjectAsync(projectDir, vcsClient),
    });
    return expWithMods.ios?.entitlements ?? {};
  } finally {
    process.env = originalProcessEnv;
  }
}

function formatError(error: any): string {
  return error.stderr?.trim() || error.stdout?.trim() || error.message;
}

export async function getNativeTargetEntitlementsAsync(
  projectDir: string,
  target: Target
): Promise<JSONObject | null> {
  const entitlementsPath = IOSConfig.Entitlements.getEntitlementsPath(projectDir, target);
  if (entitlementsPath) {
    const plist = await readPlistAsync(entitlementsPath);
    return plist ? (plist as unknown as JSONObject) : null;
  } else {
    return null;
  }
}
