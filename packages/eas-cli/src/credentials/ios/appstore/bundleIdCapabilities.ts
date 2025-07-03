import {
  BundleId,
  BundleIdCapability,
  CapabilityType,
  CapabilityTypeOption,
} from '@expo/apple-utils';
import { JSONObject } from '@expo/json-file';
import getenv from 'getenv';
import { inspect } from 'util';

import {
  CapabilityClassifier,
  CapabilityMapping,
  associatedDomainsCapabilityType,
} from './capabilityList';
import Log from '../../../log';

export const EXPO_NO_CAPABILITY_SYNC = getenv.boolish('EXPO_NO_CAPABILITY_SYNC', false);

/**
 * Given an entitlements JSON object, synchronizes the remote capabilities for a bundle identifier.
 *
 * Example entitlements JSON:
 * ```js
 * {
 *   'com.apple.developer.healthkit': true,
 *   'com.apple.developer.in-app-payments': ['merchant.com.example.development'],
 * }
 * ```
 *
 * @param bundleId bundle identifier object
 * @param entitlements JSON representation of the entitlements plist
 * @param additionalOptions Additional options to consider when syncing capabilities.
 * @returns
 */
export async function syncCapabilitiesForEntitlementsAsync(
  bundleId: BundleId,
  entitlements: JSONObject = {},
  additionalOptions: {
    usesBroadcastPushNotifications: boolean;
  }
): Promise<{ enabled: string[]; disabled: string[] }> {
  if (EXPO_NO_CAPABILITY_SYNC) {
    return { enabled: [], disabled: [] };
  }
  const currentCapabilities = await bundleId.getBundleIdCapabilitiesAsync();
  if (Log.isDebug) {
    Log.log(`Current remote capabilities:\n${JSON.stringify(currentCapabilities, null, 2)}`);
    Log.log(`\nCurrent local entitlements:\n${JSON.stringify(entitlements, null, 2)}`);
  }

  const { enabledCapabilityNames, request, remainingCapabilities } = getCapabilitiesToEnable(
    currentCapabilities,
    entitlements,
    additionalOptions
  );

  const { disabledCapabilityNames, request: modifiedRequest } = getCapabilitiesToDisable(
    bundleId,
    remainingCapabilities,
    request,
    entitlements
  );

  if (modifiedRequest.length) {
    Log.debug(`Patch Request:`, inspect(modifiedRequest, { depth: null, colors: true }));
    try {
      await bundleId.updateBundleIdCapabilityAsync(modifiedRequest);
    } catch (error: any) {
      if (error.message.match(/bundle '[\w\d]+' cannot be deleted. Delete all the Apps/)) {
        Log.error(
          'Failed to patch capabilities:',
          inspect(modifiedRequest, { depth: null, colors: true })
        );
        throw new Error(
          `Unexpected error occurred while attempting to update capabilities for app "${bundleId.attributes.identifier}".\nCapabilities can be modified manually in the Apple developer console at https://developer-mdn.apple.com/account/resources/identifiers/bundleId/edit/${bundleId.id}.\nAuto capability syncing can be disabled with the environment variable \`EXPO_NO_CAPABILITY_SYNC=1\`.\n${error.message}`
        );
      }
    }
  }

  return { enabled: enabledCapabilityNames, disabled: disabledCapabilityNames };
}

interface CapabilitiesRequest {
  capabilityType: CapabilityType;
  option: any;
}

function getCapabilitiesToEnable(
  currentRemoteCapabilities: BundleIdCapability[],
  entitlements: JSONObject,
  additionalOptions: {
    usesBroadcastPushNotifications: boolean;
  }
): {
  enabledCapabilityNames: string[];
  request: CapabilitiesRequest[];
  remainingCapabilities: BundleIdCapability[];
} {
  const enabledCapabilityNames: string[] = [];
  const request: { capabilityType: CapabilityType; option: any }[] = [];
  const remainingCapabilities = [...currentRemoteCapabilities];
  for (const [key, value] of Object.entries(entitlements)) {
    const staticCapabilityInfo = CapabilityMapping.find(
      capability => capability.entitlement === key
    );

    if (!staticCapabilityInfo) {
      if (Log.isDebug) {
        Log.log(`Skipping entitlement that is not supported by EAS: ${key}`);
      }
      continue;
    }

    assertValidOptions(staticCapabilityInfo, value);

    const existingIndex = remainingCapabilities.findIndex(existing =>
      existing.isType(staticCapabilityInfo.capability)
    );
    const existingRemote = existingIndex > -1 ? remainingCapabilities[existingIndex] : null;

    const operation = staticCapabilityInfo.getSyncOperation({
      existingRemote,
      entitlements,
      entitlementValue: value,
      additionalOptions,
    });
    const { op } = operation;

    if (Log.isDebug) {
      Log.log(`Will ${op} remote capability: ${key} (${staticCapabilityInfo.name}.`);
    }
    if (op === 'enable') {
      enabledCapabilityNames.push(staticCapabilityInfo.name);

      request.push({
        capabilityType: staticCapabilityInfo.capability,
        option: operation.option,
      });
    } else if (op === 'skip') {
      // Remove the item from the list of capabilities so we don't disable it in the next step.
      remainingCapabilities.splice(existingIndex, 1);
    }
  }

  return { enabledCapabilityNames, request, remainingCapabilities };
}

export function assertValidOptions(classifier: CapabilityClassifier, value: any): asserts value {
  if (!classifier.validateOptions(value)) {
    let reason = '';
    if (classifier.capabilityIdPrefix) {
      // Assert string array matching prefix. ASC will throw if the IDs are invalid, this just saves some time.
      reason = ` Expected an array of strings, where each string is prefixed with "${classifier.capabilityIdPrefix}", ex: ["${classifier.capabilityIdPrefix}myapp"]`;
    }
    throw new Error(
      `iOS entitlement "${classifier.entitlement}" has invalid value "${value}".${reason}`
    );
  }
}

function getCapabilitiesToDisable(
  bundleId: BundleId,
  currentCapabilities: BundleIdCapability[],
  request: CapabilitiesRequest[],
  entitlements: JSONObject
): { disabledCapabilityNames: string[]; request: CapabilitiesRequest[] } {
  if (Log.isDebug) {
    Log.log(
      `Existing to disable: `,
      currentCapabilities.map(({ id }) => id)
    );
  }
  const disabledCapabilityNames: string[] = [];

  // Disable any extras that aren't present, this functionality is kinda unreliable because managed apps
  // might be enabling capabilities in modifiers.

  for (const existingCapability of currentCapabilities) {
    // GC and IAP are always enabled in apps by default so we should avoid modifying them.
    if (
      existingCapability.isType(CapabilityType.IN_APP_PURCHASE) ||
      existingCapability.isType(CapabilityType.GAME_CENTER)
    ) {
      continue;
    }

    if (existingCapability.attributes) {
      const adjustedType = getAdjustedCapabilityType(existingCapability, bundleId);
      if (
        adjustedType === CapabilityType.MDM_MANAGED_ASSOCIATED_DOMAINS &&
        entitlements[associatedDomainsCapabilityType.entitlement]
      ) {
        // MDM Managed Associated Domains is a special case, it should not be disabled if Associated Domains is enabled.
        continue;
      }

      // Only disable capabilities that we handle,
      // this enables devs to turn on capabilities outside of EAS without worrying about us disabling them.
      const staticCapabilityInfo = CapabilityMapping.find(
        capability => capability.capability === adjustedType
      );
      if (
        staticCapabilityInfo &&
        !request.find(
          request => request.capabilityType && existingCapability.isType(request.capabilityType)
        )
      ) {
        request.push({
          // @ts-expect-error
          capabilityType: adjustedType,
          option: CapabilityTypeOption.OFF,
        });

        disabledCapabilityNames.push(staticCapabilityInfo.name);
      }
    }
  }

  return { disabledCapabilityNames, request };
}

function getAdjustedCapabilityType(
  existingCapability: BundleIdCapability,
  bundleId: BundleId
): string {
  let adjustedType: string | undefined = existingCapability.attributes.capabilityType;
  if (!adjustedType) {
    if (process.env.NODE_ENV === 'test' && !existingCapability.id.startsWith(`${bundleId.id}_`)) {
      throw new Error(
        `Capability ID "${existingCapability.id}" does not start with the bundle ID "${bundleId.id}_". This is likely a test setup issue.`
      );
    }
    adjustedType = existingCapability.id.replace(`${bundleId.id}_`, '');
  }
  return adjustedType;
}
