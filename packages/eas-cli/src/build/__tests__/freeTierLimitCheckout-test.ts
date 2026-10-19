import type { ExperimentationDefinition } from '@expo/experimentation';
import { Platform } from '@expo/eas-build-job';

import { getAgentTelemetryContext } from '../../analytics/agent';
import { BillingClient } from '../../billing/billingClient';
import { openOrPrintUrlAsync } from '../../billing/openUrl';
import { ExperimentOverrides } from '../../experimentation/ExperimentOverrides';
import {
  EMPTY_EXPERIMENTATION_DEFINITION,
  ExperimentationClient,
  createLoggerConfig,
} from '../../experimentation/ExperimentationClient';
import { LazyExperimentationClient } from '../../experimentation/LazyExperimentationClient';
import { createMockAnalytics, findUnitsByValue } from '../../experimentation/__tests__/fixtures';
import { getMockViewerUserPermission } from '../../__tests__/viewerUserPermission';
import { Permission, Role } from '../../graphql/generated';
import Log from '../../log';
import { ora } from '../../ora';
import { confirmAsync } from '../../prompts';
import { Actor } from '../../user/User';
import {
  FREE_TIER_LIMIT_CHECKOUT_EXPERIMENT_NAMESPACE,
  FreeTierLimitCheckoutExperiment,
  getFreeTierLimitCheckoutExperiment,
  isEligibleForFreeTierLimitCheckout,
  maybeOfferFreeTierLimitCheckoutAsync,
  resolveFreeTierLimitCheckoutVariantAsync,
} from '../freeTierLimitCheckout';

jest.mock('../../analytics/agent');
jest.mock('../../billing/billingClient');
jest.mock('../../billing/openUrl');
jest.mock('../../ora');
jest.mock('../../prompts');

const EXPERIMENT_NAME = 'cli-build-free-tier-limit-checkout';
const ACCOUNT_NAME = 'acme';
const AUTHENTICATION_INFO = { accessToken: 'token', sessionSecret: null } as const;
const ANALYTICS_EVENT_PROPERTIES = { tracking_id: 'tracking-id', platform: Platform.ANDROID };
const LIMIT_MESSAGE = 'Error 1\nRun eas billing:subscribe starter --account acme to upgrade to the Starter plan.';

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
      name: FREE_TIER_LIMIT_CHECKOUT_EXPERIMENT_NAMESPACE,
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

function createClient(definition: ExperimentationDefinition = ACCOUNT_DEFINITION): {
  client: ExperimentationClient;
  analytics: ReturnType<typeof createMockAnalytics>;
} {
  const analytics = createMockAnalytics();
  const client = new ExperimentationClient(
    {
      user: EMPTY_EXPERIMENTATION_DEFINITION,
      account: definition,
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
      client.getAccountNamespace(FREE_TIER_LIMIT_CHECKOUT_EXPERIMENT_NAMESPACE, { accountId }),
    'variant',
    'control',
    ['control', 'treatment']
  );
}

function createOverriddenClient(variant: string): ExperimentationClient {
  return ExperimentationClient.createDisabled(
    new ExperimentOverrides(
      new Map([[FREE_TIER_LIMIT_CHECKOUT_EXPERIMENT_NAMESPACE, new Map([['variant', variant]])]])
    )
  );
}

function account(
  id: string,
  role: Parameters<typeof getMockViewerUserPermission>[0],
  { effectivePermissions }: { effectivePermissions?: Permission[] } = {}
): Actor['accounts'][number] {
  const viewerUserPermission2 = getMockViewerUserPermission(role);
  return {
    id,
    name: ACCOUNT_NAME,
    viewerUserPermission2: {
      ...viewerUserPermission2,
      effectivePermissions: effectivePermissions ?? viewerUserPermission2.effectivePermissions,
    },
  } as Actor['accounts'][number];
}

function createExperiment(
  accountId: string,
  {
    client = createClient().client,
    accounts = [account(accountId, Role.Admin)],
    nonInteractive = false,
    runFromCI = false,
    analytics = createMockAnalytics(),
  }: {
    client?: ExperimentationClient;
    accounts?: Actor['accounts'];
    nonInteractive?: boolean;
    runFromCI?: boolean;
    analytics?: ReturnType<typeof createMockAnalytics>;
  } = {}
): FreeTierLimitCheckoutExperiment {
  return {
    experimentation: LazyExperimentationClient.fromClient(client),
    authenticationInfo: AUTHENTICATION_INFO,
    analytics,
    analyticsEventProperties: ANALYTICS_EVENT_PROPERTIES,
    actor: { id: 'actor-id', accounts } as Actor,
    accountId,
    accountName: ACCOUNT_NAME,
    nonInteractive,
    runFromCI,
  };
}

const accountIdsByVariant = findAccountIdsByVariant();
const treatmentAccountId = accountIdsByVariant.get('treatment')!;
const controlAccountId = accountIdsByVariant.get('control')!;

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getAgentTelemetryContext).mockReturnValue(null);
});

describe(getFreeTierLimitCheckoutExperiment, () => {
  const ctx = {
    analytics: createMockAnalytics(),
    analyticsEventProperties: ANALYTICS_EVENT_PROPERTIES,
    user: { id: 'actor-id', accounts: [] } as unknown as Actor,
    accountId: 'account-id',
    accountName: ACCOUNT_NAME,
    nonInteractive: false,
    runFromCI: false,
  };

  it('returns the handle when the command has an experimentation client and auth info', () => {
    const experimentation = new LazyExperimentationClient(async () => createClient().client);

    expect(
      getFreeTierLimitCheckoutExperiment({
        ...ctx,
        experimentation,
        authenticationInfo: AUTHENTICATION_INFO,
      })
    ).toEqual({
      experimentation,
      authenticationInfo: AUTHENTICATION_INFO,
      analytics: ctx.analytics,
      analyticsEventProperties: ANALYTICS_EVENT_PROPERTIES,
      actor: ctx.user,
      accountId: 'account-id',
      accountName: ACCOUNT_NAME,
      nonInteractive: false,
      runFromCI: false,
    });
  });

  it('returns undefined when the command has no experimentation client', () => {
    expect(
      getFreeTierLimitCheckoutExperiment({ ...ctx, authenticationInfo: AUTHENTICATION_INFO })
    ).toBeUndefined();
  });

  it('returns undefined when the command has no auth info', () => {
    expect(
      getFreeTierLimitCheckoutExperiment({
        ...ctx,
        experimentation: new LazyExperimentationClient(async () => createClient().client),
      })
    ).toBeUndefined();
  });
});

describe(isEligibleForFreeTierLimitCheckout, () => {
  it.each([
    ['admins', Role.Admin],
    ['owners', Role.Owner],
  ] as const)('accepts %s at an interactive terminal', (_label, role) => {
    expect(
      isEligibleForFreeTierLimitCheckout(
        createExperiment('account-id', { accounts: [account('account-id', role)] })
      )
    ).toBe(true);
  });

  it('rejects admins whose credential scopes do not allow managing billing', () => {
    expect(
      isEligibleForFreeTierLimitCheckout(
        createExperiment('account-id', {
          accounts: [
            account('account-id', Role.Admin, { effectivePermissions: [Permission.View] }),
          ],
        })
      )
    ).toBe(false);
  });

  it.each([
    ['developers', Role.Developer],
    ['view-only members', Role.ViewOnly],
  ] as const)('rejects %s', (_label, role) => {
    expect(
      isEligibleForFreeTierLimitCheckout(
        createExperiment('account-id', { accounts: [account('account-id', role)] })
      )
    ).toBe(false);
  });

  it('rejects actors who are not a member of the account', () => {
    expect(
      isEligibleForFreeTierLimitCheckout(
        createExperiment('account-id', { accounts: [account('other-account-id', Role.Admin)] })
      )
    ).toBe(false);
  });

  it('rejects non-interactive runs', () => {
    expect(
      isEligibleForFreeTierLimitCheckout(createExperiment('account-id', { nonInteractive: true }))
    ).toBe(false);
  });

  it('rejects runs from CI', () => {
    expect(
      isEligibleForFreeTierLimitCheckout(createExperiment('account-id', { runFromCI: true }))
    ).toBe(false);
  });

  it('rejects runs driven by a coding agent', () => {
    jest
      .mocked(getAgentTelemetryContext)
      .mockReturnValue({ id: 'claude-code', sessionId: 'session-1' });

    expect(isEligibleForFreeTierLimitCheckout(createExperiment('account-id'))).toBe(false);
  });
});

describe(resolveFreeTierLimitCheckoutVariantAsync, () => {
  it('does not load the client for ineligible runs', async () => {
    const loadAsync = jest.fn(async () => createClient().client);

    expect(
      await resolveFreeTierLimitCheckoutVariantAsync({
        ...createExperiment(treatmentAccountId, { nonInteractive: true }),
        experimentation: new LazyExperimentationClient(loadAsync),
      })
    ).toBe('control');
    expect(loadAsync).not.toHaveBeenCalled();
  });

  it('returns the account variant and logs the exposure once', async () => {
    const { client, analytics } = createClient();
    const experiment = createExperiment(treatmentAccountId, { client });

    expect(await resolveFreeTierLimitCheckoutVariantAsync(experiment)).toBe('treatment');
    expect(await resolveFreeTierLimitCheckoutVariantAsync(experiment)).toBe('treatment');

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
      await resolveFreeTierLimitCheckoutVariantAsync(createExperiment(controlAccountId, { client }))
    ).toBe('control');
    expect(analytics.logEvent).toHaveBeenCalledWith('Experiment Viewed', {
      experimentName: EXPERIMENT_NAME,
      variationName: 'control',
      unit: controlAccountId,
    });
  });

  it('returns control and logs no exposure when the namespace is missing from the config', async () => {
    const { client, analytics } = createClient(EMPTY_EXPERIMENTATION_DEFINITION);

    expect(
      await resolveFreeTierLimitCheckoutVariantAsync(
        createExperiment(treatmentAccountId, { client })
      )
    ).toBe('control');
    expect(analytics.logEvent).not.toHaveBeenCalled();
  });
});

describe(maybeOfferFreeTierLimitCheckoutAsync, () => {
  const createCheckoutSessionAsync = jest.fn();
  const spinner = { start: jest.fn(), stop: jest.fn(), fail: jest.fn() };
  let logErrorSpy: jest.SpyInstance;
  let logLogSpy: jest.SpyInstance;

  beforeEach(() => {
    spinner.start.mockReturnValue(spinner);
    jest.mocked(ora).mockReturnValue(spinner as any);
    jest
      .mocked(BillingClient)
      .mockImplementation(() => ({ createCheckoutSessionAsync }) as unknown as BillingClient);
    logErrorSpy = jest.spyOn(Log, 'error').mockImplementation(() => {});
    logLogSpy = jest.spyOn(Log, 'log').mockImplementation(() => {});
  });

  function treatmentExperiment(
    options: Parameters<typeof createExperiment>[1] = {}
  ): FreeTierLimitCheckoutExperiment {
    return createExperiment('account-id', { client: createOverriddenClient('treatment'), ...options });
  }

  it('does nothing when the command has no experiment handle', async () => {
    expect(await maybeOfferFreeTierLimitCheckoutAsync(LIMIT_MESSAGE, undefined)).toBe(false);
    expect(confirmAsync).not.toHaveBeenCalled();
    expect(logErrorSpy).not.toHaveBeenCalled();
  });

  it('does nothing in the control arm', async () => {
    const experiment = createExperiment('account-id', { client: createOverriddenClient('control') });

    expect(await maybeOfferFreeTierLimitCheckoutAsync(LIMIT_MESSAGE, experiment)).toBe(false);
    expect(confirmAsync).not.toHaveBeenCalled();
    expect(logErrorSpy).not.toHaveBeenCalled();
    expect(experiment.analytics.logEvent).not.toHaveBeenCalled();
  });

  it('does nothing for ineligible runs even in the treatment arm', async () => {
    const experiment = treatmentExperiment({ nonInteractive: true });

    expect(await maybeOfferFreeTierLimitCheckoutAsync(LIMIT_MESSAGE, experiment)).toBe(false);
    expect(confirmAsync).not.toHaveBeenCalled();
    expect(logErrorSpy).not.toHaveBeenCalled();
  });

  it('prints the error, then asks with No as the default', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);

    expect(await maybeOfferFreeTierLimitCheckoutAsync(LIMIT_MESSAGE, treatmentExperiment())).toBe(
      true
    );

    expect(logErrorSpy).toHaveBeenCalledWith(LIMIT_MESSAGE);
    expect(confirmAsync).toHaveBeenCalledWith(
      { message: 'Open the Starter plan checkout in your browser now?', initial: false },
      { onCancel: expect.any(Function) }
    );
    expect(logErrorSpy.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(confirmAsync).mock.invocationCallOrder[0]
    );
  });

  it('keeps the process alive on Ctrl+C so the build error still reports', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(undefined as unknown as boolean);
    const experiment = treatmentExperiment();

    expect(await maybeOfferFreeTierLimitCheckoutAsync(LIMIT_MESSAGE, experiment)).toBe(true);

    const [, options] = jest.mocked(confirmAsync).mock.calls[0];
    expect(options?.onCancel?.({} as any, {})).toBe(false);
    expect(BillingClient).not.toHaveBeenCalled();
    expect(experiment.analytics.logEvent).toHaveBeenCalledWith(
      'build cli free tier limit checkout prompt',
      { ...ANALYTICS_EVENT_PROPERTIES, answer: 'cancel', checkout_created: false }
    );
  });

  it('creates nothing when the person declines', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);
    const experiment = treatmentExperiment();

    expect(await maybeOfferFreeTierLimitCheckoutAsync(LIMIT_MESSAGE, experiment)).toBe(true);

    expect(BillingClient).not.toHaveBeenCalled();
    expect(openOrPrintUrlAsync).not.toHaveBeenCalled();
    expect(experiment.analytics.logEvent).toHaveBeenCalledWith(
      'build cli free tier limit checkout prompt',
      { ...ANALYTICS_EVENT_PROPERTIES, answer: 'no', checkout_created: false }
    );
  });

  it('opens the Starter checkout when the person accepts', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(true);
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.test/cs_1' });
    const experiment = treatmentExperiment();

    expect(await maybeOfferFreeTierLimitCheckoutAsync(LIMIT_MESSAGE, experiment)).toBe(true);

    expect(BillingClient).toHaveBeenCalledWith(AUTHENTICATION_INFO);
    expect(createCheckoutSessionAsync).toHaveBeenCalledWith('account-id', 'STARTER');
    expect(spinner.stop).toHaveBeenCalled();
    expect(spinner.fail).not.toHaveBeenCalled();
    expect(openOrPrintUrlAsync).toHaveBeenCalledWith('https://checkout.test/cs_1', {
      label: 'Checkout page',
      open: true,
    });
    expect(logLogSpy).not.toHaveBeenCalled();
    expect(experiment.analytics.logEvent).toHaveBeenCalledWith(
      'build cli free tier limit checkout prompt',
      { ...ANALYTICS_EVENT_PROPERTIES, answer: 'yes', checkout_created: true }
    );
  });

  it('prints the billing link when the checkout session request fails', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(true);
    createCheckoutSessionAsync.mockRejectedValue(new Error('network down'));
    const experiment = treatmentExperiment();

    expect(await maybeOfferFreeTierLimitCheckoutAsync(LIMIT_MESSAGE, experiment)).toBe(true);

    expect(spinner.fail).toHaveBeenCalledWith('Failed to create a checkout session');
    expect(openOrPrintUrlAsync).not.toHaveBeenCalled();
    expect(logLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(`/accounts/${ACCOUNT_NAME}/settings/billing`)
    );
    expect(experiment.analytics.logEvent).toHaveBeenCalledWith(
      'build cli free tier limit checkout prompt',
      { ...ANALYTICS_EVENT_PROPERTIES, answer: 'yes', checkout_created: false }
    );
  });

  it('prints the billing link when the checkout session has no URL', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(true);
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs_1', url: null });
    const experiment = treatmentExperiment();

    expect(await maybeOfferFreeTierLimitCheckoutAsync(LIMIT_MESSAGE, experiment)).toBe(true);

    expect(spinner.fail).toHaveBeenCalledWith('Failed to create a checkout session');
    expect(openOrPrintUrlAsync).not.toHaveBeenCalled();
    expect(logLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(`/accounts/${ACCOUNT_NAME}/settings/billing`)
    );
  });
});
