import {
  type ExperimentUnit,
  type ExperimentationDefinition,
  type LoggerConfig,
  type Namespace,
  NoOpExposureLogger,
  parseExperimentationConfig,
} from '@expo/experimentation';
import { createHash } from 'node:crypto';

import { AnalyticsExposureLogger } from './AnalyticsExposureLogger';
import {
  type ExperimentNamespace,
  FALLBACK_NAMESPACE,
  OverrideFallbackNamespace,
  SafeNamespace,
} from './ExperimentNamespace';
import { ExperimentOverrides } from './ExperimentOverrides';
import { Analytics } from '../analytics/AnalyticsManager';
import Log from '../log';

export type ExperimentationScope = 'user' | 'account' | 'device';

export type ExperimentationConfigs = Record<ExperimentationScope, ExperimentationDefinition>;

export type ExperimentationUnits = Record<ExperimentationScope, string | null>;

export const EMPTY_EXPERIMENTATION_DEFINITION: ExperimentationDefinition = {
  experiments: [],
  namespaces: [],
};

const EMPTY_CONFIGS: ExperimentationConfigs = {
  user: EMPTY_EXPERIMENTATION_DEFINITION,
  account: EMPTY_EXPERIMENTATION_DEFINITION,
  device: EMPTY_EXPERIMENTATION_DEFINITION,
};

const NULL_UNITS: ExperimentationUnits = { user: null, account: null, device: null };

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

export function createLoggerConfig(analytics: Analytics): LoggerConfig {
  return {
    flavorMap: new Map([
      ['no-op', new NoOpExposureLogger()],
      ['rudderstack', new AnalyticsExposureLogger(analytics)],
    ]),
    fallbackLoggerType: 'no-op',
  };
}

const NO_OP_LOGGER_CONFIG: LoggerConfig = {
  flavorMap: new Map([['no-op', new NoOpExposureLogger()]]),
  fallbackLoggerType: 'no-op',
};

/** Cached per (unit, name): the library deduplicates exposures per Namespace instance. */
class ScopedNamespaces {
  private readonly factories: ReadonlyMap<string, (unit: ExperimentUnit) => Namespace>;
  private readonly instances = new Map<string, Map<string, Namespace>>();

  constructor(
    definition: ExperimentationDefinition,
    loggerConfig: LoggerConfig,
    defaultUnit: string | null
  ) {
    this.factories = parseExperimentationConfig(definition, { sha1Fn: sha1 }, loggerConfig);
    // Build every namespace now so an invalid server config throws here, in the fail-open path.
    if (defaultUnit) {
      for (const name of this.factories.keys()) {
        this.getNamespace(name, defaultUnit);
      }
    }
  }

  public getNamespace(name: string, unit: string): Namespace | null {
    const factory = this.factories.get(name);
    if (!factory) {
      return null;
    }
    let byName = this.instances.get(unit);
    if (!byName) {
      byName = new Map();
      this.instances.set(unit, byName);
    }
    let namespace = byName.get(name);
    if (!namespace) {
      namespace = factory([unit]);
      byName.set(name, namespace);
    }
    return namespace;
  }
}

/**
 * Resolves experiment params for the current CLI run. Units: user is the actor ID, account is the
 * linked project's owner account (or an explicit `accountId`), device is the analytics device ID.
 * The first `getParam` on a namespace logs an exposure, so call it only where the variant is used.
 */
export class ExperimentationClient {
  private readonly scopes: Record<ExperimentationScope, ScopedNamespaces>;

  constructor(
    configs: ExperimentationConfigs,
    private readonly units: ExperimentationUnits,
    private readonly overrides: ExperimentOverrides,
    loggerConfig: LoggerConfig
  ) {
    this.scopes = {
      user: new ScopedNamespaces(configs.user, loggerConfig, units.user),
      account: new ScopedNamespaces(configs.account, loggerConfig, units.account),
      device: new ScopedNamespaces(configs.device, loggerConfig, units.device),
    };
  }

  /** Env overrides still apply, so QA can force a variant even with analytics disabled. */
  public static createDisabled(
    overrides: ExperimentOverrides = ExperimentOverrides.fromEnv()
  ): ExperimentationClient {
    return new ExperimentationClient(EMPTY_CONFIGS, NULL_UNITS, overrides, NO_OP_LOGGER_CONFIG);
  }

  public getUserNamespace(name: string): ExperimentNamespace {
    return this.resolve('user', name, this.units.user);
  }

  public getAccountNamespace(
    name: string,
    options: { accountId?: string } = {}
  ): ExperimentNamespace {
    return this.resolve('account', name, options.accountId ?? this.units.account);
  }

  public getDeviceNamespace(name: string): ExperimentNamespace {
    return this.resolve('device', name, this.units.device);
  }

  private resolve(
    scope: ExperimentationScope,
    name: string,
    unit: string | null
  ): ExperimentNamespace {
    if (this.overrides.hasNamespaceOverride(name)) {
      return new OverrideFallbackNamespace(name, this.overrides);
    }
    if (!unit) {
      return FALLBACK_NAMESPACE;
    }

    let namespace: Namespace | null;
    try {
      namespace = this.scopes[scope].getNamespace(name, unit);
    } catch (error) {
      Log.debug(
        `[experimentation] Failed to build namespace "${name}" in the ${scope} config. Returning defaults.`,
        error
      );
      return FALLBACK_NAMESPACE;
    }
    if (!namespace) {
      Log.debug(
        `[experimentation] Namespace "${name}" not found in the ${scope} config. Returning defaults.`
      );
      return FALLBACK_NAMESPACE;
    }
    return new SafeNamespace(namespace, name);
  }
}
