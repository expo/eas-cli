import ContextField, { ContextOptions } from './ContextField';
import { createGraphqlClient } from './contextUtils/createGraphqlClient';
import { AnalyticsWithOrchestration } from '../../analytics/AnalyticsManager';
import { ExperimentOverrides } from '../../experimentation/ExperimentOverrides';
import {
  ExperimentationClient,
  createLoggerConfig,
} from '../../experimentation/ExperimentationClient';
import { LazyExperimentationClient } from '../../experimentation/LazyExperimentationClient';
import { ExperimentationConfigQuery } from '../../graphql/queries/ExperimentationConfigQuery';
import Log from '../../log';

/** Caps how long the config fetch and the actor lookup can delay a command. */
const REQUEST_TIMEOUT_MS = 3000;

const CI_ENVIRONMENT_FLAGS = ['EAS_BUILD', 'CI'];

function isRunningInCi(): boolean {
  return CI_ENVIRONMENT_FLAGS.some(flag => !!process.env[flag]);
}

/**
 * Never prompts, throws, writes files, or reads the app config. A failed config fetch disables
 * all scopes. CI runs skip the fetch and get defaults.
 * The config fetch runs on the first `getClientAsync` call, so commands that never read a variant
 * make no request.
 */
export default class ExperimentationContextField extends ContextField<LazyExperimentationClient> {
  // One handle per command run, so repeated getContextAsync calls cannot log duplicate exposures.
  private readonly clientByAnalytics = new WeakMap<
    AnalyticsWithOrchestration,
    LazyExperimentationClient
  >();

  async getValueAsync(options: ContextOptions): Promise<LazyExperimentationClient> {
    let client = this.clientByAnalytics.get(options.analytics);
    if (!client) {
      client = new LazyExperimentationClient(() => this.buildClientAsync(options));
      this.clientByAnalytics.set(options.analytics, client);
    }
    return client;
  }

  private async buildClientAsync({
    sessionManager,
    analytics,
  }: ContextOptions): Promise<ExperimentationClient> {
    const overrides = ExperimentOverrides.fromEnv();

    if (isRunningInCi()) {
      Log.debug('[experimentation] Running in CI. Experiments return defaults.');
      return ExperimentationClient.createDisabled(overrides);
    }

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

      // The session manager skips the request once an actor is cached. Without a cached actor
      // (for example, a stale session) it makes its own request, so it needs the same cap.
      const [actorResult, configsResult] = await Promise.allSettled([
        sessionManager.getUserAsync({ requestTimeoutMs: REQUEST_TIMEOUT_MS }),
        ExperimentationConfigQuery.getConfigsAsync(graphqlClient),
      ]);

      if (configsResult.status === 'rejected') {
        Log.debug(
          '[experimentation] Failed to fetch the experiment config. Experiments return defaults.',
          errorMessage(configsResult.reason)
        );
        return ExperimentationClient.createDisabled(overrides);
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
