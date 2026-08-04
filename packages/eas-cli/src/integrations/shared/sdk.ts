import spawnAsync from '@expo/spawn-async';
import { ExpoConfig } from '@expo/config';
import chalk from 'chalk';

import Log from '../../log';
import { ora } from '../../ora';
import { createOrModifyExpoConfigAsync } from '../../project/expoConfig';

const DYNAMIC_CONFIG_MARKER = 'Cannot automatically write to dynamic config';

export type SdkInstallResult =
  | { status: 'installed'; dynamicConfigGuidance?: string }
  | { status: 'failed' };

export function getSpawnErrorOutput(error: unknown): string {
  const { stdout, stderr } = (error ?? {}) as { stdout?: string; stderr?: string };
  return `${stdout ?? ''}${stderr ?? ''}`;
}

export function extractDynamicConfigGuidance(output: string): string | null {
  const index = output.indexOf(DYNAMIC_CONFIG_MARKER);
  if (index === -1) {
    return null;
  }
  return output.slice(index).trim();
}

// These point eas-cli at a local or staging server; SDK packages always come from production.
export function envForExpoInstall(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.EXPO_LOCAL;
  delete env.EXPO_STAGING;
  delete env.EXPO_UNIVERSE_DIR;
  return env;
}

export async function installSdkPackagesAsync(
  projectDir: string,
  { packages, label, jsonFlag }: { packages: string[]; label: string; jsonFlag: boolean }
): Promise<SdkInstallResult> {
  const spinner = jsonFlag ? null : ora(`Installing the ${label} SDK packages`).start();
  try {
    await spawnAsync('npx', ['expo', 'install', ...packages], {
      cwd: projectDir,
      env: envForExpoInstall(),
    });
    spinner?.succeed(`Installed the ${label} SDK packages`);
    return { status: 'installed' };
  } catch (error) {
    const output = getSpawnErrorOutput(error);
    Log.debug(output || error);
    const dynamicConfigGuidance = extractDynamicConfigGuidance(output);
    if (dynamicConfigGuidance) {
      spinner?.warn(
        `Installed the ${label} SDK packages — add the config plugin to your app config`
      );
      return { status: 'installed', dynamicConfigGuidance };
    }
    spinner?.warn(`Could not install the ${label} SDK packages`);
    return { status: 'failed' };
  }
}

export async function addConfigPluginAsync(
  projectDir: string,
  exp: ExpoConfig,
  { plugin }: { plugin: string }
): Promise<string | null> {
  const plugins = exp.plugins ?? [];
  const alreadyAdded = plugins.some(p => (Array.isArray(p) ? p[0] : p) === plugin);
  if (alreadyAdded) {
    Log.withTick(`Config plugin ${chalk.bold(plugin)} is already configured`);
    return null;
  }

  const modification = await createOrModifyExpoConfigAsync(
    projectDir,
    { plugins: [...plugins, plugin] },
    { skipSDKVersionRequirement: true }
  );
  if (modification.type === 'success') {
    Log.withTick(`Added the ${chalk.bold(plugin)} config plugin`);
    return null;
  }
  if (modification.type === 'warn') {
    return `${modification.message} Add ${JSON.stringify(plugin)} to the "plugins" array in your app config.`;
  }
  return `Add ${JSON.stringify(plugin)} to the "plugins" array in your app config.`;
}

export async function setupSdkAndConfigAsync(
  projectDir: string,
  exp: ExpoConfig,
  {
    packages,
    plugin,
    label,
    jsonFlag,
  }: { packages: string[]; plugin: string; label: string; jsonFlag: boolean }
): Promise<string[]> {
  const installResult = await installSdkPackagesAsync(projectDir, { packages, label, jsonFlag });
  // Adding the plugin for a package that isn't installed leaves the app config unresolvable.
  if (installResult.status === 'failed') {
    return [
      `The ${label} SDK packages didn't install, so the ${plugin} config plugin was not added. Run npx expo install ${packages.join(' ')} from your project directory, then re-run this command.`,
    ];
  }
  if (installResult.dynamicConfigGuidance) {
    return [installResult.dynamicConfigGuidance];
  }
  const pluginManualStep = await addConfigPluginAsync(projectDir, exp, { plugin });
  return pluginManualStep ? [pluginManualStep] : [];
}
