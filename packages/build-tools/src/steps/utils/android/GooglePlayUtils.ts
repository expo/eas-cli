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
    return await GooglePlayResumableUpload.uploadAsync({
      client,
      packageName,
      editId,
      artifactPath,
      artifactType,
      signal,
      onProgress,
    });
  }
}
