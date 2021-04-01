import fs from 'fs-extra';

import { UploadType, uploadAsync } from '../../uploads';
import { createProgressTracker } from '../../utils/progress';

export async function isExistingFile(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch (e) {
    return false;
  }
}

export async function uploadAppArchiveAsync(path: string): Promise<string> {
  const fileSize = (await fs.stat(path)).size;
  const { url } = await uploadAsync(
    UploadType.SUBMISSION_APP_ARCHIVE,
    path,
    createProgressTracker({
      total: fileSize,
      message: 'Uploading to EAS Submit',
      completedMessage: 'Uploaded to EAS Submit',
    })
  );
  return url;
}
