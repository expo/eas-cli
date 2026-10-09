import type { Namespace } from '@expo/experimentation';

import Log from '../../log';
import {
  FALLBACK_NAMESPACE,
  OverrideFallbackNamespace,
  SafeNamespace,
  coerceOverrideValue,
} from '../ExperimentNamespace';
import { ExperimentOverrides, parseExperimentOverrides } from '../ExperimentOverrides';

jest.mock('../../log');

describe(coerceOverrideValue, () => {
  it('coerces booleans only from "true" and "false"', () => {
    expect(coerceOverrideValue('false', true)).toBe(false);
    expect(coerceOverrideValue('TRUE', false)).toBe(true);
    expect(coerceOverrideValue('1', false)).toBe(false);
    expect(coerceOverrideValue('yes', true)).toBe(true);
  });

  it('coerces finite numbers and falls back otherwise', () => {
    expect(coerceOverrideValue('2', 1)).toBe(2);
    expect(coerceOverrideValue('2.5', 1)).toBe(2.5);
    expect(coerceOverrideValue('x', 1)).toBe(1);
    expect(coerceOverrideValue('Infinity', 1)).toBe(1);
  });

  it('passes strings through and returns the default for empty input', () => {
    expect(coerceOverrideValue('b', 'a')).toBe('b');
    expect(coerceOverrideValue('', 'a')).toBe('a');
    expect(coerceOverrideValue('   ', 'a')).toBe('a');
    expect(coerceOverrideValue(undefined, 'a')).toBe('a');
  });
});

describe('FALLBACK_NAMESPACE', () => {
  it('returns the default for every param', () => {
    expect(FALLBACK_NAMESPACE.getParam('variant', 'control')).toBe('control');
    expect(FALLBACK_NAMESPACE.isOverridden).toBe(false);
  });
});

describe(OverrideFallbackNamespace, () => {
  const overrides = new ExperimentOverrides(parseExperimentOverrides('ns:variant=treatment'));
  const namespace = new OverrideFallbackNamespace('ns', overrides);

  it('returns the coerced override for overridden params', () => {
    expect(namespace.getParam('variant', 'control')).toBe('treatment');
    expect(namespace.isOverridden).toBe(true);
  });

  it('returns the default for params without an override', () => {
    expect(namespace.getParam('enabled', false)).toBe(false);
  });
});

describe(SafeNamespace, () => {
  it('delegates to the wrapped namespace', () => {
    const inner = { getParam: jest.fn().mockReturnValue('treatment') } as unknown as Namespace;
    expect(new SafeNamespace(inner, 'ns').getParam('variant', 'control')).toBe('treatment');
    expect(inner.getParam).toHaveBeenCalledWith('variant', 'control');
  });

  it('returns the default and logs at debug level when the wrapped namespace throws', () => {
    const inner = {
      getParam: jest.fn(() => {
        throw new Error('bad operator');
      }),
    } as unknown as Namespace;
    expect(new SafeNamespace(inner, 'ns').getParam('variant', 'control')).toBe('control');
    expect(Log.debug).toHaveBeenCalled();
  });
});
