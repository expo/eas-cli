import { SystemError, UserError } from '@expo/eas-build-job';
import spawn from '@expo/spawn-async';
import StreamZip from 'node-stream-zip';

export type AndroidArtifactType = 'apk' | 'aab';

export async function readAndroidArtifactInfoAsync(
  artifactPath: string,
  signal: AbortSignal = AbortSignal.timeout(60_000)
): Promise<{ artifactType: AndroidArtifactType; packageName: string }> {
  signal.throwIfAborted();
  const artifactType = await detectAndroidArtifactTypeAsync(artifactPath);
  if (artifactType === 'apk') {
    const packageName = await readApkPackageNameAsync(artifactPath, signal);
    return { artifactType, packageName };
  }
  const packageName = await readAabPackageNameAsync(artifactPath, signal);
  return { artifactType, packageName };
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
    throw new Error('Missing Android manifest.');
  } catch (error) {
    throw new UserError(
      'EAS_ANDROID_ARTIFACT_INVALID',
      'Expected an APK or AAB file with an Android manifest.',
      { cause: error }
    );
  } finally {
    await zip.close().catch(() => {});
  }
}

async function readApkPackageNameAsync(artifactPath: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  try {
    const { stdout } = await spawn('aapt2', ['dump', 'packagename', artifactPath], {
      stdio: 'pipe',
      signal,
      killSignal: 'SIGKILL',
    });
    signal.throwIfAborted();
    return stdout.trim();
  } catch (error) {
    signal.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new SystemError('aapt2 is not installed or is not available on the worker PATH.', {
        cause: error,
      });
    }
    throw new UserError(
      'EAS_ANDROID_MANIFEST_INVALID',
      'Cannot read the APK manifest with aapt2. Check the app binary.',
      { cause: error }
    );
  }
}

async function readAabPackageNameAsync(artifactPath: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  try {
    const { stdout } = await spawn(
      'bundletool',
      ['dump', 'manifest', '--bundle', artifactPath, '--xpath', '/manifest/@package'],
      { stdio: 'pipe', signal, killSignal: 'SIGKILL' }
    );
    signal.throwIfAborted();
    return stdout.trim();
  } catch (error) {
    signal.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new SystemError('bundletool is not installed or is not available on the worker PATH.', {
        cause: error,
      });
    }
    throw new UserError(
      'EAS_ANDROID_MANIFEST_INVALID',
      'Cannot read the AAB manifest with bundletool. Check the app binary.',
      { cause: error }
    );
  }
}
