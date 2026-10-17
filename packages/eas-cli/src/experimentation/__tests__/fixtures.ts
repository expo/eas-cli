import type { ExperimentationDefinition } from '@expo/experimentation';

import { Analytics } from '../../analytics/AnalyticsManager';
import { ExperimentNamespace } from '../ExperimentNamespace';

/**
 * - `cli-full`: every unit is in the `cli-test` experiment (50% control, 50% treatment).
 * - `cli-half`: half of the units are in `cli-test`, the rest get defaults.
 * - `cli-quiet-ns`: experiment with the `no-op` exposure logger.
 */
export const TEST_DEFINITION: ExperimentationDefinition = {
  experiments: [
    {
      experimentName: 'cli-test',
      paramDefinitions: {
        variant: { type: 'uniform_choice', choices: ['control', 'treatment'] },
        enabled: { type: 'bernoulli', p: 0.5 },
      },
      exposureLoggerType: 'rudderstack',
    },
    {
      experimentName: 'cli-quiet',
      paramDefinitions: {
        variant: { type: 'uniform_choice', choices: ['a', 'b'] },
      },
      exposureLoggerType: 'no-op',
    },
  ],
  namespaces: [
    {
      name: 'cli-full',
      numSegments: 1000,
      segmentExperimentSetupDefinitions: [
        { method: 'ADD', name: 'cli-test full', experimentName: 'cli-test', numSegments: 1000 },
      ],
    },
    {
      name: 'cli-half',
      numSegments: 1000,
      segmentExperimentSetupDefinitions: [
        { method: 'ADD', name: 'cli-test half', experimentName: 'cli-test', numSegments: 500 },
      ],
    },
    {
      name: 'cli-quiet-ns',
      numSegments: 1000,
      segmentExperimentSetupDefinitions: [
        { method: 'ADD', name: 'cli-quiet full', experimentName: 'cli-quiet', numSegments: 1000 },
      ],
    },
  ],
};

export function createMockAnalytics(): Analytics & { logEvent: jest.Mock } {
  return { logEvent: jest.fn() };
}

/**
 * Finds one unit per expected value by probing the real library, instead of hard-coding hashes.
 */
export function findUnitsByValue<T>(
  getNamespaceForUnit: (unit: string) => ExperimentNamespace,
  paramName: string,
  defaultValue: T,
  expectedValues: T[]
): Map<T, string> {
  const found = new Map<T, string>();
  for (let i = 0; i < 1000 && found.size < expectedValues.length; i++) {
    const unit = `unit-${i}`;
    const value = getNamespaceForUnit(unit).getParam(paramName, defaultValue);
    if (expectedValues.includes(value) && !found.has(value)) {
      found.set(value, unit);
    }
  }
  if (found.size !== expectedValues.length) {
    throw new Error(`Could not find units for all of: ${expectedValues.join(', ')}`);
  }
  return found;
}
