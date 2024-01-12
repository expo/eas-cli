import nullthrows from 'nullthrows';

import { FeatureGateKey } from './FeatureGateKey';
import env from '../../env';

function parseFeatureGateEnvVariableValue(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value.split(',').map(v => v.trim());
}

export default class FeatureGateEnvOverrides {
  private readonly map = new Map<string, boolean>();

  constructor() {
    const overrideEnableGateKeys = new Set(parseFeatureGateEnvVariableValue(env.featureGateEnable));
    const overrideDisableGateKeys = new Set(
      parseFeatureGateEnvVariableValue(env.featureGateDisable)
    );

    for (const overrideEnableKey of overrideEnableGateKeys) {
      if (overrideDisableGateKeys.has(overrideEnableKey)) {
        continue;
      }
      this.map.set(overrideEnableKey, true);
    }
    for (const overrideDisableGateKey of overrideDisableGateKeys) {
      this.map.set(overrideDisableGateKey, false);
    }
  }

  public isOverridden(key: FeatureGateKey): boolean {
    return this.map.has(key) ?? false;
  }

  public getOverride(key: FeatureGateKey): boolean {
    return nullthrows(this.map.get(key));
  }
}
