import type { Namespace } from '@expo/experimentation';

import { ExperimentOverrides } from './ExperimentOverrides';
import Log from '../log';

export type ExperimentNamespace = {
  getParam<T>(paramName: string, defaultValue: T): T;
  isOverridden: boolean;
};

export const FALLBACK_NAMESPACE: ExperimentNamespace = {
  getParam(_paramName, defaultValue) {
    return defaultValue;
  },
  isOverridden: false,
};

/** Serves overrides without consulting the real namespace, so no exposure is logged. */
export class OverrideFallbackNamespace implements ExperimentNamespace {
  public readonly isOverridden = true;

  constructor(
    private readonly namespaceName: string,
    private readonly overrides: ExperimentOverrides
  ) {}

  public getParam<T>(paramName: string, defaultValue: T): T {
    if (this.overrides.hasOverride(this.namespaceName, paramName)) {
      return coerceOverrideValue(
        this.overrides.getOverride(this.namespaceName, paramName),
        defaultValue
      );
    }
    return defaultValue;
  }
}

/** Returns the default instead of throwing when the library rejects a param on first read. */
export class SafeNamespace implements ExperimentNamespace {
  public readonly isOverridden = false;

  constructor(
    private readonly namespace: Namespace,
    private readonly namespaceName: string
  ) {}

  public getParam<T>(paramName: string, defaultValue: T): T {
    try {
      return this.namespace.getParam(paramName, defaultValue);
    } catch (error) {
      Log.debug(
        `[experimentation] Failed to read param "${paramName}" from namespace "${this.namespaceName}". Returning the default.`,
        error
      );
      return defaultValue;
    }
  }
}

export function coerceOverrideValue<T>(overrideValue: string | undefined, defaultValue: T): T {
  if (overrideValue === undefined || overrideValue.trim() === '') {
    return defaultValue;
  }
  if (typeof defaultValue === 'boolean') {
    const normalized = overrideValue.toLowerCase();
    if (normalized === 'true') {
      return true as T;
    }
    if (normalized === 'false') {
      return false as T;
    }
    return defaultValue;
  }
  if (typeof defaultValue === 'number') {
    const parsed = Number(overrideValue);
    return (Number.isFinite(parsed) ? parsed : defaultValue) as T;
  }
  return overrideValue as T;
}
