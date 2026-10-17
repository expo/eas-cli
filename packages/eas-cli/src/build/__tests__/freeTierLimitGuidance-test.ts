import type { ExperimentationDefinition } from '@expo/experimentation';
import { Platform } from '@expo/eas-build-job';

import { getAgentTelemetryContext } from '../../analytics/agent';
import { ExperimentOverrides } from '../../experimentation/ExperimentOverrides';
import {
  EMPTY_EXPERIMENTATION_DEFINITION,
  ExperimentationClient,
  createLoggerConfig,
} from '../../experimentation/ExperimentationClient';
import { LazyExperimentationClient } from '../../experimentation/LazyExperimentationClient';
import { createMockAnalytics, findUnitsByValue } from '../../experimentation/__tests__/fixtures';
import {
  FREE_TIER_LIMIT_AGENT_GUIDANCE_EXPERIMENT_NAMESPACE,
  getFreeTierLimitAgentGuidanceExperiment,
  maybeAppendFreeTierLimitAgentGuidanceAsync,
  resolveFreeTierLimitAgentGuidanceVariantAsync,
} from '../freeTierLimitGuidance';

jest.mock('../../analytics/agent');

const EXPERIMENT_NAME = 'cli-build-free-tier-limit-agent-guidance';

/** Every account is in the experiment: 50% control, 50% treatment. */
const ACCOUNT_DEFINITION: ExperimentationDefinition = {
  experiments: [
    {
      experimentName: EXPERIMENT_NAME,
      paramDefinitions: {
        variant: { type: 'uniform_choice', choices: ['control', 'treatment'] },
      },
      exposureLoggerType: 'rudderstack',
    },
  ],
  namespaces: [
    {
      name: FREE_TIER_LIMIT_AGENT_GUIDANCE_EXPERIMENT_NAMESPACE,
      numSegments: 1000,
      segmentExperimentSetupDefinitions: [
        {
          method: 'ADD',
          name: `${EXPERIMENT_NAME} full`,
          experimentName: EXPERIMENT_NAME,
          numSegments: 1000,
        },
      ],
    },
  ],
};

function createClient(): {
  client: ExperimentationClient;
  analytics: ReturnType<typeof createMockAnalytics>;
} {
  const analytics = createMockAnalytics();
  const client = new ExperimentationClient(
    {
      user: EMPTY_EXPERIMENTATION_DEFINITION,
      account: ACCOUNT_DEFINITION,
      device: EMPTY_EXPERIMENTATION_DEFINITION,
    },
    { user: null, device: null },
    ExperimentOverrides.empty(),
    createLoggerConfig(analytics)
  );
  return { client, analytics };
}

/** Probes a throwaway client, so the exposures it logs do not affect the client under test. */
function findAccountIdsByVariant(): Map<string, string> {
  const { client } = createClient();
  return findUnitsByValue(
    accountId =>
      client.getAccountNamespace(FREE_TIER_LIMIT_AGENT_GUIDANCE_EXPERIMENT_NAMESPACE, {
        accountId,
      }),
    'variant',
    'control',
    ['control', 'treatment']
  );
}

describe(getFreeTierLimitAgentGuidanceExperiment, () => {
  it('returns the handle when the command has an experimentation client', () => {
    const experimentation = new LazyExperimentationClient(async () => createClient().client);

    expect(
      getFreeTierLimitAgentGuidanceExperiment({ experimentation, accountId: 'account-id' })
    ).toEqual({ experimentation, accountId: 'account-id' });
  });

  it('returns undefined when the command has no experimentation client', () => {
    expect(getFreeTierLimitAgentGuidanceExperiment({ accountId: 'account-id' })).toBeUndefined();
  });
});

describe(resolveFreeTierLimitAgentGuidanceVariantAsync, () => {
  const accountIdsByVariant = findAccountIdsByVariant();
  const treatmentAccountId = accountIdsByVariant.get('treatment')!;
  const controlAccountId = accountIdsByVariant.get('control')!;

  beforeEach(() => {
    jest.resetAllMocks();
    jest
      .mocked(getAgentTelemetryContext)
      .mockReturnValue({ id: 'claude-code', sessionId: 'session-1' });
  });

  it('does not load the client when no coding agent runs the CLI', async () => {
    jest.mocked(getAgentTelemetryContext).mockReturnValue(null);
    const loadAsync = jest.fn(async () => createClient().client);

    expect(
      await resolveFreeTierLimitAgentGuidanceVariantAsync({
        experimentation: new LazyExperimentationClient(loadAsync),
        accountId: treatmentAccountId,
      })
    ).toBe('control');
    expect(loadAsync).not.toHaveBeenCalled();
  });

  it('loads the client once across repeated reads', async () => {
    const { client, analytics } = createClient();
    const loadAsync = jest.fn(async () => client);
    const experiment = {
      experimentation: new LazyExperimentationClient(loadAsync),
      accountId: treatmentAccountId,
    };

    await resolveFreeTierLimitAgentGuidanceVariantAsync(experiment);
    await resolveFreeTierLimitAgentGuidanceVariantAsync(experiment);

    expect(loadAsync).toHaveBeenCalledTimes(1);
    expect(analytics.logEvent).toHaveBeenCalledTimes(1);
  });

  it('returns control and logs no exposure when no coding agent runs the CLI', async () => {
    jest.mocked(getAgentTelemetryContext).mockReturnValue(null);
    const { client, analytics } = createClient();

    expect(
      await resolveFreeTierLimitAgentGuidanceVariantAsync({
        experimentation: LazyExperimentationClient.fromClient(client),
        accountId: treatmentAccountId,
      })
    ).toBe('control');
    expect(analytics.logEvent).not.toHaveBeenCalled();
  });

  it('returns the account variant and logs the exposure once when a coding agent runs the CLI', async () => {
    const { client, analytics } = createClient();

    expect(
      await resolveFreeTierLimitAgentGuidanceVariantAsync({
        experimentation: LazyExperimentationClient.fromClient(client),
        accountId: treatmentAccountId,
      })
    ).toBe('treatment');
    expect(
      await resolveFreeTierLimitAgentGuidanceVariantAsync({
        experimentation: LazyExperimentationClient.fromClient(client),
        accountId: treatmentAccountId,
      })
    ).toBe('treatment');

    expect(analytics.logEvent).toHaveBeenCalledTimes(1);
    expect(analytics.logEvent).toHaveBeenCalledWith('Experiment Viewed', {
      experimentName: EXPERIMENT_NAME,
      variationName: 'treatment',
      unit: treatmentAccountId,
    });
  });

  it('logs the exposure for control accounts too', async () => {
    const { client, analytics } = createClient();

    expect(
      await resolveFreeTierLimitAgentGuidanceVariantAsync({
        experimentation: LazyExperimentationClient.fromClient(client),
        accountId: controlAccountId,
      })
    ).toBe('control');
    expect(analytics.logEvent).toHaveBeenCalledWith('Experiment Viewed', {
      experimentName: EXPERIMENT_NAME,
      variationName: 'control',
      unit: controlAccountId,
    });
  });

  it('returns control and logs no exposure when the namespace is missing from the config', async () => {
    const analytics = createMockAnalytics();
    const client = new ExperimentationClient(
      {
        user: EMPTY_EXPERIMENTATION_DEFINITION,
        account: EMPTY_EXPERIMENTATION_DEFINITION,
        device: EMPTY_EXPERIMENTATION_DEFINITION,
      },
      { user: null, device: null },
      ExperimentOverrides.empty(),
      createLoggerConfig(analytics)
    );

    expect(
      await resolveFreeTierLimitAgentGuidanceVariantAsync({
        experimentation: LazyExperimentationClient.fromClient(client),
        accountId: treatmentAccountId,
      })
    ).toBe('control');
    expect(analytics.logEvent).not.toHaveBeenCalled();
  });
});

describe(maybeAppendFreeTierLimitAgentGuidanceAsync, () => {
  const treatmentAccountId = findAccountIdsByVariant().get('treatment')!;

  beforeEach(() => {
    jest.resetAllMocks();
    jest
      .mocked(getAgentTelemetryContext)
      .mockReturnValue({ id: 'claude-code', sessionId: 'session-1' });
  });

  it('returns the message unchanged and logs no exposure when the command has no experimentation client', async () => {
    expect(await maybeAppendFreeTierLimitAgentGuidanceAsync('Error 1', Platform.ANDROID, undefined)).toBe(
      'Error 1'
    );
  });

  it('logs the exposure and appends the guidance in the treatment arm', async () => {
    const { client, analytics } = createClient();

    expect(
      await maybeAppendFreeTierLimitAgentGuidanceAsync('Error 1', Platform.IOS, {
        experimentation: LazyExperimentationClient.fromClient(client),
        accountId: treatmentAccountId,
      })
    ).toBe(
      [
        'Error 1',
        'Fix: Human required: iOS builds for this account are blocked until the Free plan resets. Upgrading costs money, so an account owner or admin decides.',
      ].join('\n')
    );
    expect(analytics.logEvent).toHaveBeenCalledTimes(1);
    expect(analytics.logEvent).toHaveBeenCalledWith('Experiment Viewed', {
      experimentName: EXPERIMENT_NAME,
      variationName: 'treatment',
      unit: treatmentAccountId,
    });
  });

  it('returns the message unchanged in the control arm', async () => {
    const client = ExperimentationClient.createDisabled(
      new ExperimentOverrides(
        new Map([
          [FREE_TIER_LIMIT_AGENT_GUIDANCE_EXPERIMENT_NAMESPACE, new Map([['variant', 'control']])],
        ])
      )
    );

    expect(
      await maybeAppendFreeTierLimitAgentGuidanceAsync('Error 1', Platform.ANDROID, {
        experimentation: LazyExperimentationClient.fromClient(client),
        accountId: treatmentAccountId,
      })
    ).toBe('Error 1');
  });

  it('returns the message unchanged and logs no exposure when no coding agent runs the CLI', async () => {
    jest.mocked(getAgentTelemetryContext).mockReturnValue(null);
    const { client, analytics } = createClient();

    expect(
      await maybeAppendFreeTierLimitAgentGuidanceAsync('Error 1', Platform.ANDROID, {
        experimentation: LazyExperimentationClient.fromClient(client),
        accountId: treatmentAccountId,
      })
    ).toBe('Error 1');
    expect(analytics.logEvent).not.toHaveBeenCalled();
  });
});
