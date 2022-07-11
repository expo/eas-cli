import fs from 'fs-extra';
import { URL } from 'url';

import { UploadSessionType } from '../../graphql/generated';
import { uploadAsync } from '../../uploads';
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
  const { response } = await uploadAsync(
    UploadSessionType.EasSubmitAppArchive,
    path,
    createProgressTracker({
      total: fileSize,
      message: 'Uploading to EAS Submit',
      completedMessage: 'Uploaded to EAS Submit',
    })
  );

  const url = response.headers.get('location');
  return fixArchiveUrl(String(url));
}

/**
 * S3 returns broken URLs, sth like:
 * https://submission-service-archives.s3.amazonaws.com/production%2Fdc98ca84-1473-4cb3-ae81-8c7b291cb27e%2F4424aa95-b985-4e2f-8755-9507b1037c1c
 * This function replaces %2F with /.
 */
export function fixArchiveUrl(archiveUrl: string): string {
  const parsed = new URL(archiveUrl);
  parsed.pathname = decodeURIComponent(parsed.pathname);
  return parsed.toString();
}
