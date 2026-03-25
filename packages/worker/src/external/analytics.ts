import { ConfigItem, PluginItem, loadPartialConfig } from '@babel/core';
import { BuildContext } from '@expo/build-tools';
import { AndroidConfig, IOSConfig } from '@expo/config-plugins';
import { ExpoConfig } from '@expo/config-types';
import { BuildJob, EnvironmentSecret, Platform, Workflow } from '@expo/eas-build-job';
import spawnAsync from '@expo/spawn-async';
import { readFile, readJson } from 'fs-extra';
import os from 'os';
import path from 'path';
import semver from 'semver';

import * as RudderStack from './rudderstack';
import config from '../config';
import { maybeStringBase64Decode, simpleSecretsWhitelist } from '../secrets';
import sentry from '../sentry';

export enum Event {
  WORKER_BUILD_START = 'build turtle worker build start',
  WORKER_BUILD_SUCCESS = 'build turtle worker build success',
  WORKER_BUILD_FAIL = 'build turtle worker build fail',
  PROJECT_DEPENDENCIES = 'project dependencies',
  ARTIFACT_UPLOAD_SUCCESS = 'build turtle artifact upload success',
  ARTIFACT_UPLOAD_FAIL = 'build turtle artifact upload fail',
}

RudderStack.initialize(config.rudderstack.writeKey, config.rudderstack.dataPlaneURL);

export class Analytics extends RudderStack.Analytics<Event> {}

export async function logProjectDependenciesAsync(
  ctx: BuildContext<BuildJob>,
  analytics: Analytics,
  buildId: string
): Promise<void> {
  try {
    const packageJSON = await readJson(
      path.join(ctx.getReactNativeProjectDirectory(), 'package.json')
    );
    const dependencies = (packageJSON?.dependencies as Record<string, string> | undefined) ?? {};
    const devDependencies =
      (packageJSON?.devDependencies as Record<string, string> | undefined) ?? {};
    const projectDirectory = ctx.getReactNativeProjectDirectory();
    const plugins = filterSecretsAndParsePlugins(
      ctx.appConfig.plugins,
      ctx.job.secrets?.environmentSecrets
    );

    const babelConfig = loadPartialConfig({ cwd: projectDirectory });
    const babelPlugins =
      babelConfig?.options?.plugins
        ?.map(plugin => {
          if (isConfigItem(plugin) && plugin.file?.request) {
            return plugin?.file?.request;
          }
          return null;
        })
        .filter((i): i is string => !!i) ?? [];

    analytics.logEvent(Event.PROJECT_DEPENDENCIES, {
      buildId,
      dependencies: Object.entries(dependencies).map(dependency => ({
        name: dependency[0],
        version: dependency[1],
      })),
      devDependencies: Object.entries(devDependencies).map(dependency => ({
        name: dependency[0],
        version: dependency[1],
      })),
      packageManager: ctx.packageManager,
      packageManagerVersion: await getPackageManagerVersion(ctx.packageManager, {
        cwd: projectDirectory,
        env: ctx.env,
      }),
      jsEngine: resolveJsEngine(ctx, dependencies),
      newArchEnabled: await resolveNewArchEnabled(ctx, dependencies['react-native']),
      source: 'Turtle Worker',
      plugins,
      babelPlugins,
      iosAssociatedDomains: ctx.appConfig.ios?.associatedDomains,
      // @ts-expect-error - ApiObject is not exactly the same as AndroidIntentFiltersData though they're compatible
      androidIntentFilters: ctx.appConfig.android?.intentFilters,
    });
  } catch (error: any) {
    sentry.handleError('Failed to report project dependencies metrics', error, {
      tags: {
        errorCode: 'FAILED_TO_REPORT_PROJECT_DEPENDENCIES_EVENT',
      },
    });
  }
}

function resolveJsEngine(
  ctx: BuildContext<BuildJob>,
  dependencies: Record<string, string>
): 'jsc' | 'hermes' | 'v8' | undefined {
  const { job, appConfig } = ctx;
  const appConfigJsEngine = appConfig?.[job.platform]?.jsEngine ?? appConfig.jsEngine;
  if (job.type === Workflow.GENERIC || !ctx.metadata?.sdkVersion) {
    return undefined;
  }
  if (Object.keys(dependencies).includes('react-native-v8')) {
    if (
      appConfigJsEngine === 'jsc' ||
      (semver.satisfies(ctx.metadata.sdkVersion, '<=47') && !appConfigJsEngine)
    ) {
      return 'v8';
    }
  }

  if (appConfigJsEngine) {
    return appConfigJsEngine;
  } else if (semver.satisfies(ctx.metadata.sdkVersion, '<=47')) {
    return 'jsc';
  } else {
    return 'hermes';
  }
}

async function resolveNewArchEnabled(
  ctx: BuildContext<BuildJob>,
  reactNativeVersion: string | undefined
): Promise<boolean | undefined> {
  const { job, appConfig } = ctx;

  // Support for disabling the new architecture was removed in react-native 0.83
  if (
    reactNativeVersion &&
    semver.satisfies(reactNativeVersion, '>=0.83', { includePrerelease: true })
  ) {
    return true;
  }

  if (
    appConfig?.[job.platform]?.newArchEnabled !== undefined ||
    appConfig.newArchEnabled !== undefined
  ) {
    return appConfig?.[job.platform]?.newArchEnabled ?? appConfig.newArchEnabled;
  }

  if (job.type === Workflow.GENERIC) {
    try {
      if (job.platform === Platform.ANDROID) {
        const gradleProperties = await readFile(
          path.join(ctx.getReactNativeProjectDirectory(), 'android', 'gradle.properties'),
          'utf8'
        );

        const properties = AndroidConfig.Properties.parsePropertiesFile(gradleProperties);

        return properties.some(
          property =>
            property.type === 'property' &&
            property.key === 'newArchEnabled' &&
            property.value === 'true'
        );
      } else {
        // Check if -DRN_FABRIC_ENABLED is set on Xcode project
        const pbxProjectPath = IOSConfig.Paths.getPBXProjectPath(
          ctx.getReactNativeProjectDirectory()
        );
        const pbxProject = await readFile(pbxProjectPath, 'utf8');

        return pbxProject.includes('-DRN_FABRIC_ENABLED');
      }
    } catch (error: any) {
      sentry.handleError('Failed to detect react native new architecture', error);
      return undefined;
    }
  }

  const buildPropertiesPlugin = appConfig?.plugins?.find(
    p => Array.isArray(p) && p[0] === 'expo-build-properties'
  );

  const buildPropertiesParams = buildPropertiesPlugin?.[1];
  return buildPropertiesParams?.[job.platform]?.newArchEnabled ?? false;
}

function filterSecretsAndParsePlugins(
  plugins: ExpoConfig['plugins'],
  secrets: EnvironmentSecret[] = []
): string[] | undefined {
  const secretValues = secrets.map(({ value }) => value);
  const secretList: string[] = [
    ...secretValues,
    ...secretValues.map(maybeStringBase64Decode).filter((i): i is string => !!i),
  ].filter(i => i.length > 1 && !simpleSecretsWhitelist.includes(i));

  return plugins
    ?.map(plugin => {
      if (typeof plugin === 'string') {
        return plugin;
      } else if (Array.isArray(plugin) && plugin.length > 0) {
        const pluginStringified = JSON.stringify(plugin);

        const pluginWithoutSecrets = secretList.reduce((acc: string, pattern: string): string => {
          return acc.replaceAll(pattern, '*'.repeat(pattern.length));
        }, pluginStringified);
        return pluginWithoutSecrets;
      }
      return null;
    })
    .filter((i): i is string => !!i);
}

function isConfigItem(plugin: PluginItem): plugin is ConfigItem {
  return !Array.isArray(plugin) && (plugin as any)?.file;
}

async function getPackageManagerVersion(
  packageManager: string,
  {
    cwd,
    env,
  }: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  }
): Promise<string | undefined> {
  try {
    const { stdout } = await spawnAsync(packageManager, ['--version'], { cwd, env });
    return stdout.toString().trim();
  } catch {
    // Some package managers can fail version checks in project dirs with mismatched packageManager fields.
    try {
      const { stdout } = await spawnAsync(packageManager, ['--version'], {
        cwd: os.tmpdir(),
        env,
      });
      return stdout.toString().trim();
    } catch {
      return undefined;
    }
  }
}
