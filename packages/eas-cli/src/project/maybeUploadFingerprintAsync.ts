import { FingerprintSource, FingerprintSourceType } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { LocalBuildMode } from '../build/local';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { UploadSessionType } from '../graphql/generated';
import Log from '../log';
import { uploadFileAtPathToGCSAsync } from '../uploads';
import { getTmpDirectory } from '../utils/paths';

export async function maybeUploadFingerprintAsync({
  runtimeVersion,
  fingerprint,
  graphqlClient,
  localBuildMode,
}: {
  runtimeVersion: string;
  fingerprint: {
    fingerprintSources: object[];
    isDebugFingerprintSource: boolean;
  };
  graphqlClient: ExpoGraphqlClient;
  localBuildMode?: LocalBuildMode;
}): Promise<{
  runtimeVersion: string;
  fingerprintSource?: FingerprintSource;
}> {
  await fs.mkdirp(getTmpDirectory());
  const fingerprintLocation = path.join(getTmpDirectory(), `${uuidv4()}-runtime-fingerprint.json`);

  await fs.writeJSON(fingerprintLocation, {
    hash: runtimeVersion,
    sources: fingerprint.fingerprintSources,
  });

  if (localBuildMode === LocalBuildMode.LOCAL_BUILD_PLUGIN) {
    return {
      runtimeVersion,
      fingerprintSource: {
        type: FingerprintSourceType.PATH,
        path: fingerprintLocation,
        isDebugFingerprint: fingerprint.isDebugFingerprintSource,
      },
    };
  }

  let fingerprintGCSBucketKey = undefined;
  try {
    fingerprintGCSBucketKey = await uploadFileAtPathToGCSAsync(
      graphqlClient,
      UploadSessionType.EasUpdateFingerprint,
      fingerprintLocation
    );
  } catch (err: any) {
    let errMessage = 'Failed to upload fingerprint to EAS';

    if (err.message) {
      errMessage += `\n\nReason: ${err.message}`;
    }

    Log.warn(errMessage);
    return {
      runtimeVersion,
    };
  } finally {
    await fs.remove(fingerprintLocation);
  }

  return {
    runtimeVersion,
    fingerprintSource: {
      type: FingerprintSourceType.GCS,
      bucketKey: fingerprintGCSBucketKey,
      isDebugFingerprint: fingerprint.isDebugFingerprintSource,
    },
  };
}
