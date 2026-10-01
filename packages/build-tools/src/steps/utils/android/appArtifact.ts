import { UserError } from '@expo/eas-build-job';
import spawn from '@expo/spawn-async';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import StreamZip from 'node-stream-zip';

import { decompressTarAsync } from '../../../utils/files';

export type AndroidArtifactType = 'apk' | 'aab';

/** Resolve exactly one app. The caller owns removal of extractionDirectory, if present. */
export async function prepareAndroidArtifactAsync(artifactPath: string): Promise<{
  artifactPath: string;
  artifactType: AndroidArtifactType;
  extractionDirectory?: string;
}> {
  let extractionDirectory: string | undefined;
  try {
    const stat = await fs.lstat(artifactPath);
    if (stat.isSymbolicLink()) {
      throw new Error('An app artifact must not be a symbolic link.');
    }
    if (stat.isFile()) {
      const file = await fs.open(artifactPath, 'r');
      const header = Buffer.alloc(3);
      try {
        await file.read(header, 0, 3, 0);
      } finally {
        await file.close();
      }
      // Inspect bytes, not the extension. A ZIP can have a misleading .tar.gz suffix.
      if (!header.equals(Buffer.from([0x1f, 0x8b, 0x08]))) {
        return { artifactPath, artifactType: await detectAndroidArtifactTypeAsync(artifactPath) };
      }
      extractionDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'android-submit-'));
      await decompressTarAsync({
        archivePath: artifactPath,
        destinationDirectory: extractionDirectory,
      });
      artifactPath = extractionDirectory;
    } else if (!stat.isDirectory()) {
      throw new Error('The artifact must be a file or an extracted artifact directory.');
    }

    const candidates: { artifactPath: string; artifactType: AndroidArtifactType }[] = [];
    async function visitAsync(directory: string): Promise<void> {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          throw new Error('Artifact directories must not contain symbolic links.');
        }
        if (entry.isDirectory()) {
          await visitAsync(entryPath);
        } else if (entry.isFile()) {
          try {
            const artifactType = await detectAndroidArtifactTypeAsync(entryPath);
            candidates.push({ artifactPath: entryPath, artifactType });
          } catch (error) {
            // A named app binary that is damaged must not be silently skipped.
            if (/\.(apk|aab)$/i.test(entry.name)) {
              throw error;
            }
          }
        }
      }
    }
    await visitAsync(artifactPath);
    if (candidates.length !== 1) {
      throw new Error(
        `Expected exactly one APK or AAB in the artifact; found ${candidates.length}. Provide a specific binary path.`
      );
    }
    return { ...candidates[0], extractionDirectory };
  } catch (error) {
    if (extractionDirectory) {
      await fs.rm(extractionDirectory, { recursive: true, force: true }).catch(() => {});
    }
    if (error instanceof UserError) {
      throw error;
    }
    throw new UserError(
      'EAS_ANDROID_ARTIFACT_INVALID',
      `Cannot read Android artifact: ${(error as Error).message}`
    );
  }
}

async function detectAndroidArtifactTypeAsync(artifactPath: string): Promise<AndroidArtifactType> {
  const zip = new StreamZip.async({ file: artifactPath });
  try {
    const entries = await zip.entries();
    if (
      entries['BundleConfig.pb'] &&
      !entries['BundleConfig.pb'].isDirectory &&
      entries['base/manifest/AndroidManifest.xml'] &&
      !entries['base/manifest/AndroidManifest.xml'].isDirectory
    ) {
      return 'aab';
    }
    if (
      entries['AndroidManifest.xml'] &&
      !entries['AndroidManifest.xml'].isDirectory &&
      !entries['BundleConfig.pb']
    ) {
      return 'apk';
    }
    throw new Error('The ZIP is not an APK or AAB.');
  } finally {
    await zip.close().catch(() => {});
  }
}

export async function readAndroidPackageNameAsync(
  artifactPath: string,
  artifactType: AndroidArtifactType,
  signal?: AbortSignal
): Promise<string> {
  const command = artifactType === 'apk' ? 'aapt2' : 'bundletool';
  const args =
    artifactType === 'apk'
      ? ['dump', 'badging', artifactPath]
      : ['dump', 'manifest', '--bundle', artifactPath, '--xpath', '/manifest/@package'];
  signal?.throwIfAborted();
  const child = spawn(command, args, { stdio: 'pipe' });
  const abort = (): void => {
    child.child.kill('SIGKILL');
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const { stdout } = await child;
    signal?.throwIfAborted();
    const packageName =
      artifactType === 'apk' ? /package:\s+name='([^']+)'/m.exec(stdout)?.[1] : stdout.trim();
    if (!packageName || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) {
      throw new Error('Missing or invalid package name in the Android manifest.');
    }
    return packageName;
  } catch (error) {
    signal?.throwIfAborted();
    throw new UserError(
      'EAS_ANDROID_MANIFEST_INVALID',
      `Cannot read the app package with ${command}. Check the binary and ensure ${command} is installed on the worker.`
    );
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
