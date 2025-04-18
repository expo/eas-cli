import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AssetMapSourceInput, AssetMapSourceType, UploadSessionType } from '../graphql/generated';
import Log from '../log';
import { uploadFileAtPathToGCSAsync } from '../uploads';
import { formatBytes } from '../utils/files';
import { createProgressTracker } from '../utils/progress';

export async function maybeUploadAssetMapAsync(
  distRoot: string,
  graphqlClient: ExpoGraphqlClient
): Promise<AssetMapSourceInput | null> {
  const assetMapPath = path.join(distRoot, 'assetmap.json');

  if (!(await fs.pathExists(assetMapPath))) {
    return null;
  }

  let gcsBucketKey = undefined;
  const fileStat = await fs.promises.stat(assetMapPath);
  try {
    gcsBucketKey = await uploadFileAtPathToGCSAsync(
      graphqlClient,
      UploadSessionType.EasUpdateAssetsMetadata,
      assetMapPath,
      createProgressTracker({
        total: fileStat.size,
        message: ratio =>
          `Uploading assetmap.json (${formatBytes(fileStat.size * ratio)} / ${formatBytes(
            fileStat.size
          )})`,
        completedMessage: (duration: string) => `Uploaded assetmap.json ${chalk.dim(duration)}`,
      })
    );
  } catch (err: any) {
    let errMessage = 'Failed to upload assetmap to EAS';

    if (err.message) {
      errMessage += `\n\nReason: ${err.message}`;
    }

    Log.warn(errMessage);
    return null;
  }

  return {
    type: AssetMapSourceType.Gcs,
    bucketKey: gcsBucketKey,
  };
}
