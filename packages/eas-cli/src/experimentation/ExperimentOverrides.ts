import env from '../env';

export type ExperimentOverrideMap = ReadonlyMap<string, ReadonlyMap<string, string>>;

/**
 * Parses `EAS_EXPERIMENT_OVERRIDE`: comma-separated `namespace:param=value` entries. Values may
 * contain `:` and `=` but not `,`. Overrides are keyed by namespace name and apply in every scope.
 *
 * @example EAS_EXPERIMENT_OVERRIDE="onboarding:variant=treatment,cli-hints:enabled=true"
 */
export function parseExperimentOverrides(rawValue: string | undefined): ExperimentOverrideMap {
  const overrideMap = new Map<string, Map<string, string>>();
  if (!rawValue) {
    return overrideMap;
  }

  for (const entry of rawValue.split(',')) {
    const override = entry.trim();
    if (!override) {
      continue;
    }

    const firstEqualsIndex = override.indexOf('=');
    if (firstEqualsIndex === -1) {
      continue;
    }
    const namespaceAndParam = override.slice(0, firstEqualsIndex);
    const value = override.slice(firstEqualsIndex + 1).trim();

    const firstColonIndex = namespaceAndParam.indexOf(':');
    if (firstColonIndex === -1) {
      continue;
    }
    const namespace = namespaceAndParam.slice(0, firstColonIndex).trim();
    const param = namespaceAndParam.slice(firstColonIndex + 1).trim();
    if (!namespace || !param) {
      continue;
    }

    let params = overrideMap.get(namespace);
    if (!params) {
      params = new Map();
      overrideMap.set(namespace, params);
    }
    params.set(param, value);
  }

  return overrideMap;
}

export class ExperimentOverrides {
  constructor(private readonly overrideMap: ExperimentOverrideMap) {}

  public static fromEnv(): ExperimentOverrides {
    return new ExperimentOverrides(parseExperimentOverrides(env.experimentOverride));
  }

  public static empty(): ExperimentOverrides {
    return new ExperimentOverrides(new Map());
  }

  public hasNamespaceOverride(namespace: string): boolean {
    return this.overrideMap.has(namespace);
  }

  public hasOverride(namespace: string, param: string): boolean {
    return this.overrideMap.get(namespace)?.has(param) ?? false;
  }

  public getOverride(namespace: string, param: string): string | undefined {
    return this.overrideMap.get(namespace)?.get(param);
  }
}
