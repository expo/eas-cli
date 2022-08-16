import fs from 'fs-extra';

import { UploadSessionType } from '../../graphql/generated';
import { uploadFileAtPathToS3Async } from '../../uploads';
import { createProgressTracker } from '../../utils/progress';

export async function isExistingFileAsync(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

export async function uploadAppArchiveAsync(path: string): Promise<string> {
  const fileSize = (await fs.stat(path)).size;
  const { url } = await uploadFileAtPathToS3Async(
    UploadSessionType.EasSubmitAppArchive,
    path,
    createProgressTracker({
      total: fileSize,
      message: 'Uploading to EAS Submit',
      completedMessage: 'Uploaded to EAS Submit',
    })
  );
  return url;
}
