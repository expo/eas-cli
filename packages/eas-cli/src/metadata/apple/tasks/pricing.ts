import { App, AppPrice, Territory } from '@expo/apple-utils';
import chalk from 'chalk';

import Log from '../../../log';
import { logAsync } from '../../utils/log';
import { AppleTask, TaskDownloadOptions, TaskPrepareOptions, TaskUploadOptions } from '../task';
import { ApplePriceScheduleEntry, AppleTerritoryCode } from '../types';

/**
 * Sentinel territory list meaning "make the app available in every supported
 * App Store territory". Resolved at upload time against
 * `Territory.getAsync` so we don't drift if Apple adds new territories.
 */
export const AVAILABILITY_ALL = 'all' as const;

export type PricingData = {
  /**
   * Current `AppPrice` records for the app. Each record encodes a (startDate,
   * priceTier) pair — the active price tier is the most recent entry whose
   * startDate is in the past.
   */
  appPrices: AppPrice[];
  /** Territories the app is currently available in. */
  availableTerritories: Territory[];
};

/**
 * Task for managing app pricing (price tier + scheduled changes) and
 * territory availability. Apple groups these together because both are set
 * via the legacy `App` PATCH endpoint that `@expo/apple-utils` exposes via
 * `App.updateAsync({ appPriceTier, territories })`.
 *
 * Newer App Store Connect APIs (`appPriceSchedules`, `appAvailabilities`)
 * supersede this for accounts on the post-2023 base-territory pricing model,
 * but those endpoints are not yet wrapped by `@expo/apple-utils`. The reader
 * accepts a `pricing.schedule` block that we can wire up once the new
 * helpers land.
 *
 * TODO(expo/third-party#147): Once `@expo/apple-utils` is bumped to include
 * the new pricing helpers, wire up schedule push:
 *
 *   - Use `AppPriceSchedule.createAsync(context, { appId, baseTerritoryId, manualPrices })`
 *     to push the full schedule. Each `manualPrices` entry takes
 *     `{ appPricePointId, startDate?, endDate? }`.
 *
 *   - IMPORTANT: `AppPriceSchedule.createAsync` REPLACES the entire prior
 *     schedule. When pushing, the full schedule from config must be sent --
 *     omitting entries will remove them from App Store Connect. There is no
 *     diff/merge behavior.
 *
 *   - Use `AppPricePoint.getForAppAsync(context, appId, { query })` to
 *     resolve tier names to `appPricePointId` values, filterable by territory.
 *
 *   - Use `App.getPriceScheduleAsync()` to read the current schedule (singular
 *     relationship: `apps/{id}/appPriceSchedule`).
 *
 *   - Territory availability is separate from pricing in the modern API --
 *     it's managed via `TerritoryAvailability`, not via price schedules.
 *     The legacy `App.updateAsync({ territories })` path used below still
 *     works for setting availability.
 */
export class PricingTask extends AppleTask {
  public name = (): string => 'pricing and availability';

  public async prepareAsync({ context }: TaskPrepareOptions): Promise<void> {
    context.appPrices = [];
    context.availableTerritories = [];

    // Pull the current `prices` and `availableTerritories` relationships
    // onto the in-memory App object. We refetch via `infoAsync` because the
    // App used elsewhere in the flow is loaded without these includes.
    let appWithPricing: App;
    try {
      appWithPricing = await App.infoAsync(context.app.context, {
        id: context.app.id,
        query: {
          includes: ['prices', 'prices.priceTier', 'availableTerritories'],
        },
      });
    } catch (error: any) {
      // Pricing/availability are not always retrievable for every app state
      // (e.g. apps removed from sale, or accounts on the new pricing model
      // that 404 the legacy endpoints). Don't block the rest of the sync.
      Log.warn(
        chalk`{yellow Skipped pricing/availability prepare - failed to load: ${error?.message ?? error}}`
      );
      return;
    }

    context.appPrices = appWithPricing.attributes.prices ?? [];
    context.availableTerritories = appWithPricing.attributes.availableTerritories ?? [];
  }

  public async downloadAsync({ config, context }: TaskDownloadOptions): Promise<void> {
    // Pricing → schema.pricing
    const sortedPrices = [...(context.appPrices ?? [])].sort((a, b) =>
      (a.attributes.startDate ?? '').localeCompare(b.attributes.startDate ?? '')
    );

    if (sortedPrices.length === 0) {
      config.setPricing(null);
    } else {
      // The "current" tier is the most recent entry whose startDate is in
      // the past (or the earliest entry if everything is in the future).
      const now = new Date().toISOString();
      const past = sortedPrices.filter(p => (p.attributes.startDate ?? '') <= now);
      const currentEntry = past.length > 0 ? past[past.length - 1] : sortedPrices[0];
      const future = sortedPrices.filter(p => (p.attributes.startDate ?? '') > now);

      const schedule: ApplePriceScheduleEntry[] = future.map(p => ({
        startDate: p.attributes.startDate,
        tier: p.attributes.priceTier?.id ?? '',
      }));

      config.setPricing({
        tier: currentEntry.attributes.priceTier?.id,
        schedule: schedule.length > 0 ? schedule : undefined,
      });
    }

    // Availability → schema.availability
    const territories = context.availableTerritories ?? [];
    if (territories.length === 0) {
      config.setAvailability(null);
    } else {
      config.setAvailability({
        territories: territories.map(t => t.id),
      });
    }
  }

  public async uploadAsync({ config, context }: TaskUploadOptions): Promise<void> {
    const pricing = config.getPricing();
    const availability = config.getAvailability();

    if (!pricing && !availability) {
      Log.log(chalk`{dim - Skipped pricing and availability, not configured}`);
      return;
    }

    if (pricing?.schedule && pricing.schedule.length > 0) {
      // TODO(expo/third-party#147): Replace this warning with a call to
      // AppPriceSchedule.createAsync once @expo/apple-utils is bumped.
      // Remember: createAsync REPLACES the entire schedule, so the full
      // config must be sent (not just the diff).
      Log.warn(
        chalk`{yellow pricing.schedule is not yet pushed. Scheduled price changes require a newer @expo/apple-utils with AppPriceSchedule support (see expo/third-party#147). Only pricing.tier is applied.}`
      );
    }

    // Territory availability is set via the legacy App.updateAsync({ territories })
    // endpoint below. The modern ASC API uses TerritoryAvailability as a separate
    // resource from pricing (not part of appPriceSchedules). The legacy path works
    // for both old and new pricing-model accounts.
    let resolvedTerritories: AppleTerritoryCode[] | undefined;
    if (availability?.territories) {
      resolvedTerritories = await resolveTerritoriesAsync({
        context,
        desired: availability.territories,
      });
    }

    const appPriceTier = pricing?.tier;
    if (appPriceTier == null && resolvedTerritories == null) {
      // Nothing to do — both blocks were configured but neither set a value
      // we can act on (e.g. only `pricing.schedule` was provided).
      return;
    }

    const summary: string[] = [];
    if (appPriceTier != null) {
      summary.push(`tier ${chalk.bold(appPriceTier)}`);
    }
    if (resolvedTerritories != null) {
      summary.push(`${chalk.bold(resolvedTerritories.length)} territories`);
    }

    context.app = await logAsync(
      () =>
        context.app.updateAsync({
          appPriceTier,
          territories: resolvedTerritories,
        }),
      {
        pending: `Updating pricing and availability (${summary.join(', ')})...`,
        success: `Updated pricing and availability (${summary.join(', ')})`,
        failure: 'Failed to update pricing and availability',
      }
    );
  }
}

/**
 * Resolve a desired territory list (either an explicit code list or the
 * `'all'` sentinel) into an array of ISO territory codes the App Store
 * Connect API will accept.
 */
async function resolveTerritoriesAsync({
  context,
  desired,
}: {
  context: { app: App };
  desired: AppleTerritoryCode[] | typeof AVAILABILITY_ALL;
}): Promise<AppleTerritoryCode[]> {
  if (desired === AVAILABILITY_ALL) {
    const territories = await Territory.getAsync(context.app.context, {
      query: { limit: 200 },
    });
    return territories.map(t => t.id);
  }
  // Deduplicate, drop empties, and uppercase to match ASC's canonical form.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of desired) {
    if (!code) {
      continue;
    }
    const normalized = code.toUpperCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
