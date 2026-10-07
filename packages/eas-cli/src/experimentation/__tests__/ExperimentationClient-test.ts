import type { ExperimentationDefinition } from '@expo/experimentation';

import Log from '../../log';
import {
  EMPTY_EXPERIMENTATION_DEFINITION,
  ExperimentationClient,
  ExperimentationConfigs,
  ExperimentationUnits,
  createLoggerConfig,
} from '../ExperimentationClient';
import { ExperimentOverrides, parseExperimentOverrides } from '../ExperimentOverrides';
import { TEST_DEFINITION, createMockAnalytics, findUnitsByValue } from './fixtures';
import { FALLBACK_NAMESPACE } from '../ExperimentNamespace';

jest.mock('../../log');
jest.mock('../../env', () => ({
  __esModule: true,
  default: { experimentOverride: 'cli-full:variant=from-env' },
}));

function createClient({
  configs = {},
  units = {},
  overrides = ExperimentOverrides.empty(),
  analytics = createMockAnalytics(),
}: {
  configs?: Partial<ExperimentationConfigs>;
  units?: Partial<ExperimentationUnits>;
  overrides?: ExperimentOverrides;
  analytics?: ReturnType<typeof createMockAnalytics>;
} = {}): { client: ExperimentationClient; analytics: ReturnType<typeof createMockAnalytics> } {
  const client = new ExperimentationClient(
    {
      user: configs.user ?? EMPTY_EXPERIMENTATION_DEFINITION,
      account: configs.account ?? EMPTY_EXPERIMENTATION_DEFINITION,
      device: configs.device ?? EMPTY_EXPERIMENTATION_DEFINITION,
    },
    { user: units.user ?? null, account: units.account ?? null, device: units.device ?? null },
    overrides,
    createLoggerConfig(analytics)
  );
  return { client, analytics };
}

function userClientForUnit(unit: string): ExperimentationClient {
  return createClient({ configs: { user: TEST_DEFINITION }, units: { user: unit } }).client;
}

const unitsByVariant = findUnitsByValue(
  unit => userClientForUnit(unit).getUserNamespace('cli-full'),
  'variant',
  'control',
  ['control', 'treatment']
);
const controlUnit = unitsByVariant.get('control')!;
const treatmentUnit = unitsByVariant.get('treatment')!;

beforeEach(() => {
  jest.clearAllMocks();
});

describe(findUnitsByValue, () => {
  it('throws when no unit produces an expected value', () => {
    expect(() => findUnitsByValue(() => FALLBACK_NAMESPACE, 'variant', 'x', ['never'])).toThrow(
      'Could not find units for all of: never'
    );
  });
});

describe(ExperimentationClient, () => {
  describe('assignment', () => {
    it('gives the same unit the same variant across clients', () => {
      const first = userClientForUnit(treatmentUnit).getUserNamespace('cli-full');
      const second = userClientForUnit(treatmentUnit).getUserNamespace('cli-full');
      expect(first.getParam('variant', 'control')).toBe('treatment');
      expect(second.getParam('variant', 'control')).toBe('treatment');
      expect(
        userClientForUnit(controlUnit).getUserNamespace('cli-full').getParam('variant', 'x')
      ).toBe('control');
    });

    it('returns the default and logs at debug level for an unknown namespace', () => {
      const { client, analytics } = createClient({
        configs: { user: TEST_DEFINITION },
        units: { user: treatmentUnit },
      });
      expect(client.getUserNamespace('missing').getParam('variant', 'control')).toBe('control');
      expect(Log.debug).toHaveBeenCalledWith(expect.stringContaining('"missing"'));
      expect(analytics.logEvent).not.toHaveBeenCalled();
    });

    it('returns the default and logs no exposure when the scope has no unit', () => {
      const { client, analytics } = createClient({ configs: { account: TEST_DEFINITION } });
      expect(client.getAccountNamespace('cli-full').getParam('variant', 'control')).toBe('control');
      expect(analytics.logEvent).not.toHaveBeenCalled();
      expect(Log.debug).not.toHaveBeenCalled();
    });

    it('treats an empty string unit like a missing unit', () => {
      const { client, analytics } = createClient({
        configs: { account: TEST_DEFINITION },
        units: { account: '' },
      });
      expect(client.getAccountNamespace('cli-full').getParam('variant', 'control')).toBe('control');
      expect(analytics.logEvent).not.toHaveBeenCalled();
    });

    it('uses an explicit account ID over the default account unit', () => {
      const { client } = createClient({
        configs: { account: TEST_DEFINITION },
        units: { account: controlUnit },
      });
      expect(client.getAccountNamespace('cli-full').getParam('variant', 'x')).toBe('control');
      expect(
        client
          .getAccountNamespace('cli-full', { accountId: treatmentUnit })
          .getParam('variant', 'x')
      ).toBe('treatment');
    });

    it('resolves the same namespace name independently per scope', () => {
      const scoped = (choice: string): ExperimentationDefinition => ({
        experiments: [
          {
            experimentName: 'shared',
            paramDefinitions: { variant: { type: 'uniform_choice', choices: [choice] } },
            exposureLoggerType: 'no-op',
          },
        ],
        namespaces: [
          {
            name: 'shared',
            numSegments: 10,
            segmentExperimentSetupDefinitions: [
              { method: 'ADD', name: 'all', experimentName: 'shared', numSegments: 10 },
            ],
          },
        ],
      });
      const { client } = createClient({
        configs: {
          user: scoped('from-user'),
          account: scoped('from-account'),
          device: scoped('from-device'),
        },
        units: { user: 'u', account: 'a', device: 'd' },
      });
      expect(client.getUserNamespace('shared').getParam('variant', 'x')).toBe('from-user');
      expect(client.getAccountNamespace('shared').getParam('variant', 'x')).toBe('from-account');
      expect(client.getDeviceNamespace('shared').getParam('variant', 'x')).toBe('from-device');
    });

    it('returns the default and logs no exposure for a unit outside the allocated segments', () => {
      const unallocated = findUnitsByValue(
        unit => userClientForUnit(unit).getUserNamespace('cli-half'),
        'variant',
        'not-allocated',
        ['not-allocated']
      ).get('not-allocated')!;
      const { client, analytics } = createClient({
        configs: { user: TEST_DEFINITION },
        units: { user: unallocated },
      });
      expect(client.getUserNamespace('cli-half').getParam('variant', 'control')).toBe('control');
      expect(analytics.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('exposure logging', () => {
    it('logs one exposure per namespace per client', () => {
      const { client, analytics } = createClient({
        configs: { user: TEST_DEFINITION },
        units: { user: treatmentUnit },
      });
      const namespace = client.getUserNamespace('cli-full');
      namespace.getParam('variant', 'control');
      namespace.getParam('enabled', false);
      client.getUserNamespace('cli-full').getParam('variant', 'control');

      expect(analytics.logEvent).toHaveBeenCalledTimes(1);
      expect(analytics.logEvent).toHaveBeenCalledWith('Experiment Viewed', {
        experimentName: 'cli-test',
        variationName: 'treatment',
        unit: treatmentUnit,
      });
    });

    it('logs again for a second client with the same unit, so clients must be cached per command', () => {
      const analytics = createMockAnalytics();
      createClient({
        configs: { user: TEST_DEFINITION },
        units: { user: treatmentUnit },
        analytics,
      })
        .client.getUserNamespace('cli-full')
        .getParam('variant', 'control');
      createClient({
        configs: { user: TEST_DEFINITION },
        units: { user: treatmentUnit },
        analytics,
      })
        .client.getUserNamespace('cli-full')
        .getParam('variant', 'control');
      expect(analytics.logEvent).toHaveBeenCalledTimes(2);
    });

    it('logs nothing for experiments that use the no-op logger', () => {
      const { client, analytics } = createClient({
        configs: { user: TEST_DEFINITION },
        units: { user: 'unit-1' },
      });
      expect(['a', 'b']).toContain(
        client.getUserNamespace('cli-quiet-ns').getParam('variant', 'x')
      );
      expect(analytics.logEvent).not.toHaveBeenCalled();
    });

    it('falls back to the no-op logger for an unknown exposureLoggerType', () => {
      const definition: ExperimentationDefinition = {
        experiments: [
          {
            experimentName: 'odd',
            paramDefinitions: { variant: { type: 'uniform_choice', choices: ['only'] } },
            exposureLoggerType: 'something-else',
          },
        ],
        namespaces: [
          {
            name: 'odd',
            numSegments: 10,
            segmentExperimentSetupDefinitions: [
              { method: 'ADD', name: 'all', experimentName: 'odd', numSegments: 10 },
            ],
          },
        ],
      };
      const { client, analytics } = createClient({
        configs: { user: definition },
        units: { user: 'u' },
      });
      expect(client.getUserNamespace('odd').getParam('variant', 'x')).toBe('only');
      expect(analytics.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('overrides', () => {
    it('returns the override instead of the assigned variant and logs no exposure', () => {
      const { client, analytics } = createClient({
        configs: { user: TEST_DEFINITION },
        units: { user: controlUnit },
        overrides: new ExperimentOverrides(parseExperimentOverrides('cli-full:variant=treatment')),
      });
      const namespace = client.getUserNamespace('cli-full');
      expect(namespace.isOverridden).toBe(true);
      expect(namespace.getParam('variant', 'control')).toBe('treatment');
      expect(analytics.logEvent).not.toHaveBeenCalled();
    });

    it('returns the default for other params of an overridden namespace without logging an exposure', () => {
      const { client, analytics } = createClient({
        configs: { user: TEST_DEFINITION },
        units: { user: controlUnit },
        overrides: new ExperimentOverrides(parseExperimentOverrides('cli-full:variant=treatment')),
      });
      expect(client.getUserNamespace('cli-full').getParam('enabled', false)).toBe(false);
      expect(analytics.logEvent).not.toHaveBeenCalled();
    });

    it('applies overrides to namespaces that are not in the server config', () => {
      const { client } = createClient({
        overrides: new ExperimentOverrides(
          parseExperimentOverrides('not-deployed:variant=treatment')
        ),
      });
      expect(client.getUserNamespace('not-deployed').getParam('variant', 'control')).toBe(
        'treatment'
      );
    });

    it('applies the same override in every scope', () => {
      const { client } = createClient({
        overrides: new ExperimentOverrides(parseExperimentOverrides('ns:enabled=true')),
      });
      expect(client.getUserNamespace('ns').getParam('enabled', false)).toBe(true);
      expect(client.getAccountNamespace('ns').getParam('enabled', false)).toBe(true);
      expect(client.getDeviceNamespace('ns').getParam('enabled', false)).toBe(true);
    });
  });

  describe('invalid server config', () => {
    it('returns the default without throwing when a param uses an unknown operator', () => {
      const definition = {
        experiments: [
          {
            experimentName: 'broken',
            paramDefinitions: { variant: { type: 'not-an-operator' } },
            exposureLoggerType: 'rudderstack',
          },
        ],
        namespaces: [
          {
            name: 'broken',
            numSegments: 10,
            segmentExperimentSetupDefinitions: [
              { method: 'ADD', name: 'all', experimentName: 'broken', numSegments: 10 },
            ],
          },
        ],
      } as unknown as ExperimentationDefinition;
      const { client } = createClient({ configs: { user: definition }, units: { user: 'u' } });
      expect(client.getUserNamespace('broken').getParam('variant', 'control')).toBe('control');
      expect(Log.debug).toHaveBeenCalled();
    });

    const overAllocated: ExperimentationDefinition = {
      experiments: TEST_DEFINITION.experiments,
      namespaces: [
        {
          name: 'too-many',
          numSegments: 10,
          segmentExperimentSetupDefinitions: [
            { method: 'ADD', name: 'all', experimentName: 'cli-test', numSegments: 20 },
          ],
        },
      ],
    };

    it('throws during construction when a namespace over-allocates segments', () => {
      expect(() =>
        createClient({ configs: { user: overAllocated }, units: { user: 'u' } })
      ).toThrow(/requested 20 segments/);
    });

    it('returns the default when a namespace fails to build for an explicit account ID', () => {
      // No default account unit, so nothing is built eagerly and the failure surfaces on lookup.
      const { client, analytics } = createClient({ configs: { account: overAllocated } });
      expect(
        client.getAccountNamespace('too-many', { accountId: 'a' }).getParam('variant', 'control')
      ).toBe('control');
      expect(Log.debug).toHaveBeenCalledWith(
        expect.stringContaining('Failed to build namespace'),
        expect.anything()
      );
      expect(analytics.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('createDisabled', () => {
    it('returns defaults for every scope and logs nothing', () => {
      const client = ExperimentationClient.createDisabled(ExperimentOverrides.empty());
      expect(client.getUserNamespace('cli-full').getParam('variant', 'control')).toBe('control');
      expect(client.getAccountNamespace('cli-full').getParam('variant', 'control')).toBe('control');
      expect(client.getDeviceNamespace('cli-full').getParam('variant', 'control')).toBe('control');
      expect(Log.debug).not.toHaveBeenCalled();
    });

    it('reads overrides from the environment by default', () => {
      const client = ExperimentationClient.createDisabled();
      expect(client.getUserNamespace('cli-full').getParam('variant', 'control')).toBe('from-env');
    });

    it('still honors overrides', () => {
      const client = ExperimentationClient.createDisabled(
        new ExperimentOverrides(parseExperimentOverrides('cli-full:variant=treatment'))
      );
      expect(client.getUserNamespace('cli-full').getParam('variant', 'control')).toBe('treatment');
    });
  });
});
