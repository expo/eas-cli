import { BundleId, CapabilityTypeOption } from '@expo/apple-utils';
import { JSONObject } from '@expo/json-file';

import Log from '../../../log';
import { CapabilityMapping, EXPO_NO_CAPABILITY_SYNC } from './bundleIdCapabilities';

type UpdateCapabilityRequest = Parameters<BundleId['updateBundleIdCapabilityAsync']>[0];

/**
 * Sync the capability identifiers with the bundle identifier capabilities.
 * If a capability identifier is missing, then attempt to create it.
 * Link all of the capability identifiers at the same time after parsing the entitlements file.
 *
 * @param bundleId Bundle identifier object.
 * @param entitlements JSON representation of the iOS entitlements plist
 * @returns
 */
export async function syncCapabilityIdentifiersForEntitlementsAsync(
  bundleId: BundleId,
  entitlements: JSONObject = {}
): Promise<{ created: string[]; linked: string[] }> {
  if (EXPO_NO_CAPABILITY_SYNC) {
    return { created: [], linked: [] };
  }

  const createdIds: string[] = [];
  const linkedIds: string[] = [];
  const CapabilityIdMapping = CapabilityMapping.filter(capability => capability.capabilityIdModel);

  const updateRequest: UpdateCapabilityRequest = [];

  // Iterate through the supported capabilities to build the request.
  for (const classifier of CapabilityIdMapping) {
    const CapabilityModel = classifier.capabilityIdModel;
    // Skip capabilities that don't support capability IDs.
    if (!CapabilityModel) continue;

    // Skip capabilities that aren't defined in the entitlements file.
    let capabilityIds = entitlements[classifier.entitlement] as string[];
    if (!capabilityIds) continue;

    // Assert string array matching prefix. ASC will throw if the IDs are invalid, this just saves some time.
    if (!classifier.validateOptions(capabilityIds)) {
      throw new Error(
        `iOS entitlement "${classifier.entitlement}" has invalid incorrectly formatted identifier list: "${capabilityIds}".`
      );
    }

    // Remove any duplicates to cut down on network requests
    capabilityIds = [...new Set(capabilityIds)];

    // Get a list of all of the capability IDs that are already created on the server.
    const existingIds = await CapabilityModel.getAsync(bundleId.context);

    // A list of server IDs for linking.
    const capabilityIdOpaqueIds = [];

    // Iterate through all the local IDs and see if they exist on the server.
    for (const localId of capabilityIds) {
      let remoteIdModel = existingIds.find(model => model.attributes.identifier === localId);

      // If a remote ID exists, then create it.
      if (!remoteIdModel) {
        if (Log.isDebug) Log.log(`Creating capability ID: ${localId} (${CapabilityModel.type})`);
        try {
          remoteIdModel = await CapabilityModel.createAsync(bundleId.context, {
            identifier: localId,
          });
        } catch (error) {
          // Add a more helpful error message.
          error.message += `\n\nRemove the value '${localId}' from the array '${classifier.entitlement}' in the iOS project entitlements.\nIf you know that the ID is registered to one of your apps, try again with a different Apple account.`;
          throw error;
        }
        // Create a list of newly created IDs for displaying in the CLI.
        createdIds.push(localId);
        if (Log.isDebug) Log.log(`Created capability ID: ${remoteIdModel.id}`);
      }
      if (Log.isDebug)
        Log.log(`Linking ID to ${CapabilityModel.type}: ${localId} (${remoteIdModel.id})`);
      // Create a list of linked IDs for displaying in the CLI.
      linkedIds.push(remoteIdModel.attributes.identifier);
      capabilityIdOpaqueIds.push(remoteIdModel.id);
    }

    updateRequest.push({
      capabilityType: classifier.capability,
      option: CapabilityTypeOption.ON,
      relationships: {
        // One of: `merchantIds`, `appGroups`, `cloudContainers`.
        [CapabilityModel.type]: capabilityIdOpaqueIds,
      },
    });
  }

  if (updateRequest.length) {
    if (Log.isDebug)
      Log.log(`Updating bundle identifier with capability identifiers:`, updateRequest);
    await bundleId.updateBundleIdCapabilityAsync(updateRequest);
  } else if (Log.isDebug) {
    Log.log(`No capability identifiers need to be updated`);
  }
  return { created: createdIds, linked: linkedIds };
}
