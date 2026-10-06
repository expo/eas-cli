import { z } from 'zod';

import { GooglePlayClient } from './GooglePlayClient';
import { GooglePlayResumableUpload } from './GooglePlayResumableUpload';
import { AndroidArtifactType } from './appArtifact';

export namespace GooglePlayUtils {
  export async function uploadAsync({
    client,
    packageName,
    editId,
    artifactPath,
    artifactType,
    signal,
    onProgress,
  }: {
    client: GooglePlayClient;
    packageName: string;
    editId: string;
    artifactPath: string;
    artifactType: AndroidArtifactType;
    signal?: AbortSignal;
    onProgress: (uploadedBytes: number, totalBytes: number) => void;
  }): Promise<number> {
    const resource = artifactType === 'apk' ? 'apks' : 'bundles';
    const result = await new GooglePlayResumableUpload(client).uploadAsync({
      uploadPath: `/upload/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}/${resource}?uploadType=resumable`,
      artifactPath,
      contentType:
        artifactType === 'apk'
          ? 'application/vnd.android.package-archive'
          : 'application/octet-stream',
      signal,
      onProgress,
    });
    const parsed = z
      .object({ versionCode: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })
      .safeParse(result);
    if (!parsed.success) {
      throw new Error('Google completed the upload without a valid version code.');
    }
    return parsed.data.versionCode;
  }
}
