import { getConfig, getConfigFilePaths } from '@expo/config';

import ContextField, { ContextOptions } from './ContextField';
import { ExpoGraphqlClient, createGraphqlClient } from './contextUtils/createGraphqlClient';
import { findProjectRootAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { AnalyticsWithOrchestration } from '../../analytics/AnalyticsManager';
import { ExperimentOverrides } from '../../experimentation/ExperimentOverrides';
import {
  ExperimentationClient,
  createLoggerConfig,
} from '../../experimentation/ExperimentationClient';
import { ExperimentationConfigQuery } from '../../graphql/queries/ExperimentationConfigQuery';
import Log from '../../log';

/** Caps how long the config fetch can delay a command. */
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Never prompts, throws, or writes files. A failed config fetch disables all scopes; a failed
 * account lookup disables only the account scope.
 */
export default class ExperimentationContextField extends ContextField<ExperimentationClient> {
  // One client per command run, so repeated getContextAsync calls cannot log duplicate exposures.
  private readonly clientByAnalytics = new WeakMap<
    AnalyticsWithOrchestration,
    Promise<ExperimentationClient>
  >();

  async getValueAsync(options: ContextOptions): Promise<ExperimentationClient> {
    let pending = this.clientByAnalytics.get(options.analytics);
    if (!pending) {
      pending = this.buildClientAsync(options);
      this.clientByAnalytics.set(options.analytics, pending);
    }
    return await pending;
  }

  private async buildClientAsync({
    sessionManager,
    analytics,
    projectIdOverride,
  }: ContextOptions): Promise<ExperimentationClient> {
    const overrides = ExperimentOverrides.fromEnv();

    const deviceId = analytics.getDeviceId();
    if (deviceId === null) {
      Log.debug('[experimentation] Analytics is disabled. Experiments return defaults.');
      return ExperimentationClient.createDisabled(overrides);
    }

    try {
      const graphqlClient = createGraphqlClient(
        {
          accessToken: sessionManager.getAccessToken(),
          sessionSecret: sessionManager.getSessionSecret(),
        },
        { requestTimeoutMs: REQUEST_TIMEOUT_MS }
      );

      const [actorResult, configsResult, accountIdResult] = await Promise.allSettled([
        sessionManager.getUserAsync(),
        ExperimentationConfigQuery.getConfigsAsync(graphqlClient),
        resolveAccountIdAsync(graphqlClient, projectIdOverride),
      ]);

      if (configsResult.status === 'rejected') {
        Log.debug(
          '[experimentation] Failed to fetch the experiment config. Experiments return defaults.',
          errorMessage(configsResult.reason)
        );
        return ExperimentationClient.createDisabled(overrides);
      }
      if (accountIdResult.status === 'rejected') {
        Log.debug(
          '[experimentation] Failed to resolve the project owner account. Account experiments return defaults.',
          errorMessage(accountIdResult.reason)
        );
      }

      const configs = configsResult.value;
      return new ExperimentationClient(
        {
          user: configs.userConfig,
          account: configs.accountConfig,
          device: configs.deviceConfig,
        },
        {
          user: actorResult.status === 'fulfilled' ? (actorResult.value?.id ?? null) : null,
          account: accountIdResult.status === 'fulfilled' ? accountIdResult.value : null,
          device: deviceId,
        },
        overrides,
        createLoggerConfig(analytics)
      );
    } catch (error) {
      Log.debug(
        '[experimentation] Failed to initialize experiments. Experiments return defaults.',
        errorMessage(error)
      );
      return ExperimentationClient.createDisabled(overrides);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resolveAccountIdAsync(
  graphqlClient: ExpoGraphqlClient,
  projectIdOverride: string | undefined
): Promise<string | null> {
  const projectId = projectIdOverride ?? (await readLinkedProjectIdAsync());
  if (!projectId) {
    return null;
  }
  return await ExperimentationConfigQuery.getOwnerAccountIdForProjectAsync(
    graphqlClient,
    projectId
  );
}

async function readLinkedProjectIdAsync(): Promise<string | null> {
  let projectDir: string;
  try {
    projectDir = await findProjectRootAsync();
  } catch {
    return null;
  }

  const paths = getConfigFilePaths(projectDir);
  if (!paths.staticConfigPath && !paths.dynamicConfigPath) {
    return null;
  }

  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true, skipPlugins: true });
  const projectId = exp.extra?.eas?.projectId;
  return typeof projectId === 'string' && projectId ? projectId : null;
}
