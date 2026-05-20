import {
  AppDataUsage,
  AppDataUsageCategoryId,
  AppDataUsageDataProtectionId,
  AppDataUsagePurposeId,
  AppDataUsagesPublishState,
} from '@expo/apple-utils';
import chalk from 'chalk';

import Log from '../../../log';
import { logAsync } from '../../utils/log';
import { AppleTask, TaskDownloadOptions, TaskPrepareOptions, TaskUploadOptions } from '../task';
import {
  AppleDataUsage,
  AppleDataUsageCategoryEntry,
  AppleDataUsageCategoryId as AppleDataUsageCategoryIdString,
  AppleDataUsageDataProtectionId as AppleDataUsageDataProtectionIdString,
  AppleDataUsagePurposeId as AppleDataUsagePurposeIdString,
} from '../types';

export type DataUsageData = {
  /**
   * Existing AppDataUsage rows on App Store Connect for the current app.
   * One row per (category, purpose, dataProtection) tuple. Populated during
   * `prepareAsync` and refreshed after `uploadAsync` makes mutations.
   */
  dataUsages: AppDataUsage[];
  /**
   * The publish-state envelope for the data usage section. Apple gates the
   * Privacy Nutrition Labels behind a separate `publish` flag — until this is
   * set to `published: true`, the values authored above won't take effect on
   * the storefront. The model is keyed by the App id (the IRIS endpoint is
   * non-standard and there's only ever one).
   */
  dataUsagesPublishState: AppDataUsagesPublishState | null;
};

/**
 * Sync App Privacy Nutrition Labels (data usage) to/from App Store Connect.
 *
 * Apple has required every new app submission since 2021 to declare what data
 * the app collects, the purposes it's used for, and how it's linked to the
 * user. Each declaration is a tuple of (category, purpose, protection) — for
 * example "CONTACTS used for ANALYTICS, linked to the user". The local config
 * groups these by category for ergonomics; on push we expand each row into the
 * cartesian product of (category × purpose × protection) and reconcile against
 * the existing rows in App Store Connect.
 *
 * The task is declarative: any rows in ASC that aren't present in the local
 * config are deleted, any rows in the local config that aren't in ASC are
 * created, and existing rows are left untouched. After a successful push the
 * publish-state envelope is flipped to `published: true` so the changes
 * actually appear on the App Store.
 */
export class DataUsageTask extends AppleTask {
  public name = (): string => 'data usage (privacy nutrition labels)';

  public async prepareAsync({ context }: TaskPrepareOptions): Promise<void> {
    context.dataUsages = [];
    context.dataUsagesPublishState = null;
    try {
      context.dataUsages = await context.app.getAppDataUsagesAsync();
    } catch (error: any) {
      // Apps that have never opened the App Privacy section yet may return
      // 404 / NOT_FOUND from the iris endpoint. That's fine — treat it as
      // "no rows" and continue. Anything else is unexpected and surfaces.
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
    try {
      const states = await context.app.getAppDataUsagesPublishStateAsync();
      context.dataUsagesPublishState = states[0] ?? null;
    } catch (error: any) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  public async downloadAsync({ config, context }: TaskDownloadOptions): Promise<void> {
    const dataUsage = collapseDataUsageRows(context.dataUsages ?? []);
    if (!dataUsage) {
      // Don't write anything when the app has no rows declared at all — leave
      // `privacy.dataUsage` absent in the schema rather than emitting an empty
      // object that round-trips into a no-op publish.
      config.setDataUsage(null);
      return;
    }
    config.setDataUsage(dataUsage);
  }

  public async uploadAsync({ config, context }: TaskUploadOptions): Promise<void> {
    const desired = config.getDataUsage();
    if (!desired) {
      Log.log(chalk`{dim - Skipped data usage, not configured}`);
      return;
    }

    const desiredRows = expandDataUsageRows(desired);
    const existingRows = context.dataUsages ?? [];

    // Build a stable key for each (category, purpose, protection) tuple so we
    // can diff existing vs desired rows. Categories and protections may be
    // null on the existing rows when the relationship isn't included.
    const existingByKey = new Map<string, AppDataUsage>();
    for (const row of existingRows) {
      const key = rowKey(
        (row.attributes.category?.id as AppDataUsageCategoryId | undefined) ?? null,
        (row.attributes.purpose?.id as AppDataUsagePurposeId | undefined) ?? null,
        (row.attributes.dataProtection?.id as AppDataUsageDataProtectionId | undefined) ?? null
      );
      existingByKey.set(key, row);
    }

    const desiredByKey = new Map<
      string,
      {
        category: AppDataUsageCategoryId | null;
        purpose: AppDataUsagePurposeId | null;
        protection: AppDataUsageDataProtectionId | null;
      }
    >();
    for (const row of desiredRows) {
      desiredByKey.set(rowKey(row.category, row.purpose, row.protection), row);
    }

    // Delete rows that exist on ASC but aren't in the local config.
    let deleted = 0;
    for (const [key, row] of existingByKey) {
      if (!desiredByKey.has(key)) {
        await row.deleteAsync();
        deleted += 1;
      }
    }

    // Create rows that are in the local config but missing from ASC.
    let created = 0;
    const createdRows: AppDataUsage[] = [];
    for (const [key, row] of desiredByKey) {
      if (existingByKey.has(key)) {
        continue;
      }
      const newRow = await context.app.createAppDataUsageAsync({
        appDataUsageCategory: row.category ?? undefined,
        appDataUsageProtection: row.protection ?? undefined,
        appDataUsagePurpose: row.purpose ?? undefined,
      });
      createdRows.push(newRow);
      created += 1;
    }

    if (created === 0 && deleted === 0) {
      Log.log(chalk`{dim - Skipped data usage, no changes}`);
    } else {
      Log.log(
        chalk`{dim - Synced data usage: ${String(created)} created, ${String(deleted)} deleted}`
      );
      // Refresh in-memory state so subsequent invocations see the new rows.
      context.dataUsages = [
        ...existingRows.filter(row => {
          const key = rowKey(
            (row.attributes.category?.id as AppDataUsageCategoryId | undefined) ?? null,
            (row.attributes.purpose?.id as AppDataUsagePurposeId | undefined) ?? null,
            (row.attributes.dataProtection?.id as AppDataUsageDataProtectionId | undefined) ?? null
          );
          return desiredByKey.has(key);
        }),
        ...createdRows,
      ];
    }

    // Apple gates the Privacy Nutrition Labels behind a separate publish
    // state. Without flipping `published: true` after a write, the rows above
    // won't take effect on the storefront. The publish state model is keyed
    // by the app id and there's only ever one — refetch it after the writes
    // in case it's drifted.
    const publishState =
      context.dataUsagesPublishState ?? (await context.app.getAppDataUsagesPublishStateAsync())[0];
    if (!publishState) {
      Log.warn(
        chalk`{yellow Could not load data usage publish state — changes may not appear on the App Store. Publish manually from App Store Connect.}`
      );
      return;
    }

    context.dataUsagesPublishState = await logAsync(
      () => publishState.updateAsync({ published: true }),
      {
        pending: 'Publishing data usage (privacy nutrition labels)...',
        success: 'Published data usage (privacy nutrition labels)',
        failure: 'Failed publishing data usage (privacy nutrition labels)',
      }
    );
  }
}

/**
 * Build a deterministic key for a (category, purpose, protection) tuple.
 * Nulls are folded in so that rows with missing relationships still diff
 * correctly against the desired state.
 */
function rowKey(
  category: string | null | undefined,
  purpose: string | null | undefined,
  protection: string | null | undefined
): string {
  return `${category ?? ''}::${purpose ?? ''}::${protection ?? ''}`;
}

/**
 * Expand a config-shaped {@link AppleDataUsage} into the flat list of
 * (category, purpose, protection) tuples that App Store Connect actually
 * stores. When `dataNotCollected` is true we emit a single sentinel row that
 * declares the app collects no data; this matches Apple's "Data Not Collected"
 * toggle, which is just a special row with no category/purpose/protection.
 */
function expandDataUsageRows(dataUsage: AppleDataUsage): {
  category: AppDataUsageCategoryId | null;
  purpose: AppDataUsagePurposeId | null;
  protection: AppDataUsageDataProtectionId | null;
}[] {
  if (dataUsage.dataNotCollected) {
    return [{ category: null, purpose: null, protection: null }];
  }
  const rows: {
    category: AppDataUsageCategoryId | null;
    purpose: AppDataUsagePurposeId | null;
    protection: AppDataUsageDataProtectionId | null;
  }[] = [];
  for (const entry of dataUsage.categories ?? []) {
    const purposes = entry.purposes && entry.purposes.length > 0 ? entry.purposes : [null];
    const protections =
      entry.protections && entry.protections.length > 0 ? entry.protections : [null];
    for (const purpose of purposes) {
      for (const protection of protections) {
        rows.push({
          category: entry.category as AppDataUsageCategoryId,
          purpose: (purpose as AppDataUsagePurposeId | null) ?? null,
          protection: (protection as AppDataUsageDataProtectionId | null) ?? null,
        });
      }
    }
  }
  return rows;
}

/**
 * Collapse the flat list of {@link AppDataUsage} rows from App Store Connect
 * back into the grouped {@link AppleDataUsage} schema we serialize to the
 * config. Rows are grouped by category; purposes and protections within a
 * category are deduped. Returns `null` when there are no rows.
 */
function collapseDataUsageRows(rows: AppDataUsage[]): AppleDataUsage | null {
  if (rows.length === 0) {
    return null;
  }
  const byCategory = new Map<string, { purposes: Set<string>; protections: Set<string> }>();
  let dataNotCollected = false;
  for (const row of rows) {
    const categoryId = row.attributes.category?.id;
    const purposeId = row.attributes.purpose?.id;
    const protectionId = row.attributes.dataProtection?.id;
    // A row with no category/purpose/protection at all is the "Data Not
    // Collected" sentinel. We don't surface its DATA_NOT_COLLECTED protection
    // either — when present we just flip the top-level toggle.
    if (!categoryId && !purposeId && protectionId === 'DATA_NOT_COLLECTED') {
      dataNotCollected = true;
      continue;
    }
    if (!categoryId) {
      continue;
    }
    let bucket = byCategory.get(categoryId);
    if (!bucket) {
      bucket = { purposes: new Set(), protections: new Set() };
      byCategory.set(categoryId, bucket);
    }
    if (purposeId) {
      bucket.purposes.add(purposeId);
    }
    if (protectionId) {
      bucket.protections.add(protectionId);
    }
  }

  if (dataNotCollected && byCategory.size === 0) {
    return { dataNotCollected: true };
  }

  if (byCategory.size === 0) {
    return null;
  }

  const categories: AppleDataUsageCategoryEntry[] = [];
  for (const [category, { purposes, protections }] of byCategory) {
    categories.push({
      category: category as AppleDataUsageCategoryIdString,
      purposes:
        purposes.size > 0 ? (Array.from(purposes) as AppleDataUsagePurposeIdString[]) : undefined,
      protections:
        protections.size > 0
          ? (Array.from(protections) as AppleDataUsageDataProtectionIdString[])
          : undefined,
    });
  }
  // Stable category ordering keeps the generated config diff-friendly.
  categories.sort((a, b) => a.category.localeCompare(b.category));
  return { categories };
}

function isNotFoundError(error: any): boolean {
  if (!error) {
    return false;
  }
  const status = error?.response?.status ?? error?.status;
  if (status === 404) {
    return true;
  }
  const message = String(error?.message ?? '');
  return /not.?found|404/i.test(message);
}
