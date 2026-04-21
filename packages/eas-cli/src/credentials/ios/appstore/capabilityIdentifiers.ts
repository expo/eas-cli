import { BundleId, CapabilityTypeOption } from '@expo/apple-utils';
import { JSONObject } from '@expo/json-file';

import { EXPO_NO_CAPABILITY_SYNC, assertValidOptions } from './bundleIdCapabilities';
import { CapabilityMapping } from './capabilityList';
import Log from '../../../log';
import { isAppStoreConnectTokenOnlyContext } from '../utils/authType';

type UpdateCapabilityRequest = Parameters<BundleId['updateBundleIdCapabilityAsync']>[0];

/**
 * Sync the capability identifiers with the bundle identifier capabilities.
 * If a capability identifier is missing, then attempt to create it.
 * Link all of the capability identifiers at the same time after parsing the entitlements file.
 *
 * **Does not support App Store Connect API (CI).**
 *
 * @param bundleId Bundle identifier object.
 * @param entitlements JSON representation of the iOS entitlements plist
 *
 * @returns an object specifying the capabilities that were linked, and created.
 */
export async function syncCapabilityIdentifiersForEntitlementsAsync(
  bundleId: BundleId,
  entitlements: JSONObject = {}
): Promise<{ created: string[]; linked: string[] }> {
  if (EXPO_NO_CAPABILITY_SYNC) {
    return { created: [], linked: [] };
  }

  // App Store Connect token authentication is not currently supported,
  // the team ID is required to create capability identifiers.
  if (isAppStoreConnectTokenOnlyContext(bundleId.context)) {
    Log.warn(
      `Skipping capability identifier syncing because the current Apple authentication session is not using Cookies (username/password).`
    );
    return { created: [], linked: [] };
  }

  const createdIds: string[] = [];
  const linkedIds: string[] = [];
  // these are only APPLE_PAY, ICLOUD, APP_GROUPS
  const CapabilityIdMapping = CapabilityMapping.filter(capability => capability.capabilityIdModel);

  const updateRequest: UpdateCapabilityRequest = [];

  // Fetch the bundle with its linked capability identifiers to check for already linked identifiers.
  const bundleWithRelationships = await BundleId.infoAsync(bundleId.context, {
    id: bundleId.id,
    query: {
      includes: [
        'bundleIdCapabilities',
        'bundleIdCapabilities.appGroups',
        'bundleIdCapabilities.merchantIds',
        'bundleIdCapabilities.cloudContainers',
      ],
    },
  });
  const linkedBundleCapabilities = bundleWithRelationships.attributes.bundleIdCapabilities ?? [];

  // Iterate through the supported capabilities to build the request.
  for (const classifier of CapabilityIdMapping) {
    const CapabilityModel = classifier.capabilityIdModel;
    // Skip capabilities that don't support capability IDs.
    if (!CapabilityModel) {
      continue;
    }

    const validate = (value: any): value is string[] => {
      if (!value) {
        return false;
      }
      assertValidOptions(classifier, value);
      return true;
    };

    // Skip capabilities that aren't defined in the entitlements file.
    const entitlementValue = entitlements[classifier.entitlement];

    if (!validate(entitlementValue)) {
      continue;
    }

    // Remove any duplicates to cut down on network requests
    const capabilityIds: string[] = [...new Set(entitlementValue)];

    // Get a list of all of the capability IDs that are already created on the server.
    const existingIds = await CapabilityModel.getAsync(bundleId.context);

    // Opaque ids of identifiers already linked to this capability.
    const remoteLinkedIds = linkedBundleCapabilities.find(c => c.isType(classifier.capability))
      ?.attributes as Record<string, { id: string }[] | undefined> | undefined;
    const alreadyLinkedOpaqueIds = new Set<string>(
      (remoteLinkedIds?.[CapabilityModel.type] ?? []).map(model => model.id)
    );

    // A list of server IDs for linking.
    const capabilityIdOpaqueIds: string[] = [];

    // Iterate through all the local IDs and see if they exist on the server.
    for (const localId of capabilityIds) {
      let remoteIdModel = existingIds.find(model => model.attributes.identifier === localId);

      // Identifier already exists.
      if (remoteIdModel) {
        if (!alreadyLinkedOpaqueIds.has(remoteIdModel.id)) {
          // Link the existing identifier to this bundle.
          linkedIds.push(remoteIdModel.attributes.identifier);
          capabilityIdOpaqueIds.push(remoteIdModel.id);
        }
        continue;
      }

      if (Log.isDebug) {
        Log.log(`Creating capability ID: ${localId} (${CapabilityModel.type})`);
      }
      try {
        remoteIdModel = await CapabilityModel.createAsync(bundleId.context, {
          identifier: localId,
        });
      } catch (error: any) {
        // Add a more helpful error message.
        error.message += `\n\nRemove the value '${localId}' from the array '${classifier.entitlement}' in the iOS project entitlements.\nIf you know that the ID is registered to one of your apps, try again with a different Apple account.`;
        throw error;
      }
      if (Log.isDebug) {
        Log.log(`Created capability ID: ${remoteIdModel.id}`);
      }
      // add to a list of newly created IDs for displaying in the CLI.
      createdIds.push(localId);
      // add to a list of linked IDs for displaying in the CLI.
      linkedIds.push(remoteIdModel.attributes.identifier);
      capabilityIdOpaqueIds.push(remoteIdModel.id);
    }

    if (capabilityIdOpaqueIds.length) {
      updateRequest.push({
        capabilityType: classifier.capability,
        option: CapabilityTypeOption.ON,
        relationships: {
          // One of: `merchantIds`, `appGroups`, `cloudContainers`.
          [CapabilityModel.type]: capabilityIdOpaqueIds,
        },
      });
    }
  }

  if (updateRequest.length) {
    if (Log.isDebug) {
      Log.log(
        `Updating bundle identifier with capability identifiers:`,
        JSON.stringify(updateRequest, null, 2)
      );
    }
    await bundleId.updateBundleIdCapabilityAsync(updateRequest);
  } else if (Log.isDebug) {
    Log.log(`No capability identifiers need to be updated`);
  }
  return { created: createdIds, linked: linkedIds };
}
