import { InAppPurchase } from '@expo/apple-utils';
import chalk from 'chalk';

import Log from '../../../log';
import { AppleTask, TaskDownloadOptions, TaskPrepareOptions, TaskUploadOptions } from '../task';

export type InAppPurchasesData = {
  /**
   * The list of in-app purchases registered for the app, keyed by `productId`.
   * The map is empty when the app has no IAPs (or none are visible to the
   * authenticated account).
   */
  inAppPurchases: Map<string, InAppPurchase>;
};

/**
 * Task for managing the basic listing of In-App Purchases (declarative
 * round-trip of `productId`, `referenceName`, and `inAppPurchaseType`).
 *
 * Scope (intentional, see PR description):
 * - Pull (download): writes the existing IAPs to `store.config.json`.
 * - Push (upload): no-op for now. `@expo/apple-utils` only exposes
 *   read access to the deprecated v1 `inAppPurchases` resource — there is
 *   no create/update/delete and no v2 (`inAppPurchasesV2`) wrapper yet.
 *   When the user has IAPs in their config that don't exist (or differ) in
 *   ASC, we emit a warning so the round-trip is still informative without
 *   silently dropping intent.
 *
 * Explicitly out of scope for this iteration:
 * - Localizations (no `InAppPurchaseLocalization` model in apple-utils)
 * - Pricing, review screenshots, content hosting, family sharing
 * - Deletes — we never delete IAPs that exist in ASC but are missing from
 *   config. Too dangerous for a first iteration.
 */
export class InAppPurchasesTask extends AppleTask {
  public name = (): string => 'in-app purchases';

  public async prepareAsync({ context }: TaskPrepareOptions): Promise<void> {
    context.inAppPurchases = new Map();

    try {
      const purchases = await context.app.getInAppPurchasesAsync();
      for (const purchase of purchases) {
        const productId = purchase.attributes.productId;
        if (productId) {
          context.inAppPurchases.set(productId, purchase);
        }
      }
    } catch (error: any) {
      // The IAP endpoint is on the iris API and may be unavailable for some
      // accounts/apps (e.g. apps that have never had an IAP, or accounts
      // without the right entitlements). Treat as empty rather than fatal.
      Log.warn(
        chalk`{yellow Skipped in-app purchases - failed to load from App Store Connect: ${error?.message ?? error}}`
      );
    }
  }

  public async downloadAsync({ config, context }: TaskDownloadOptions): Promise<void> {
    const entries = Array.from(context.inAppPurchases.values()).map(purchase => ({
      productId: purchase.attributes.productId,
      referenceName: purchase.attributes.referenceName,
      type: purchase.attributes.inAppPurchaseType as unknown as string,
      state: (purchase.attributes.state as unknown as string) ?? undefined,
    }));
    config.setInAppPurchases(entries);
  }

  public async uploadAsync({ config, context }: TaskUploadOptions): Promise<void> {
    const desired = config.getInAppPurchases();
    if (!desired || desired.length === 0) {
      Log.log(chalk`{dim - Skipped in-app purchases, none configured}`);
      return;
    }

    // Match desired entries against the existing ASC inventory by productId.
    // We never delete; we only report what would change. Apple's v1
    // inAppPurchases endpoint exposed by @expo/apple-utils is read-only,
    // so we can't actually create or patch records here.
    const existing = context.inAppPurchases;
    const toCreate: typeof desired = [];
    const toUpdate: { productId: string; from: string; to: string }[] = [];
    let unchanged = 0;

    for (const entry of desired) {
      const current = existing.get(entry.productId);
      if (!current) {
        toCreate.push(entry);
        continue;
      }
      if (
        entry.referenceName &&
        current.attributes.referenceName !== entry.referenceName
      ) {
        toUpdate.push({
          productId: entry.productId,
          from: current.attributes.referenceName,
          to: entry.referenceName,
        });
      } else {
        unchanged++;
      }
    }

    if (unchanged > 0) {
      Log.log(
        chalk`{dim - In-app purchases: ${unchanged} already in sync}`
      );
    }

    if (toCreate.length === 0 && toUpdate.length === 0) {
      return;
    }

    // We intentionally only warn here. See class doc-comment.
    Log.warn(
      chalk`{yellow In-app purchase mutations are not yet supported by EAS metadata.}`
    );
    Log.warn(
      chalk`{yellow @expo/apple-utils currently exposes the deprecated v1 inAppPurchases resource as read-only. Mutations require the v2 (inAppPurchasesV2) wrapper, which is tracked as a follow-up.}`
    );

    for (const entry of toCreate) {
      Log.warn(
        chalk`  {yellow Would create IAP ${chalk.bold(entry.productId)} (${entry.type}) — ${entry.referenceName}}`
      );
    }
    for (const entry of toUpdate) {
      Log.warn(
        chalk`  {yellow Would rename IAP ${chalk.bold(entry.productId)}: ${entry.from} → ${entry.to}}`
      );
    }
    Log.warn(
      chalk`{yellow Apply these changes manually in App Store Connect for now.}`
    );
  }
}
