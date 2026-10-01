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
  const packageName = await (artifactType === 'apk'
    ? readApkPackageNameAsync(artifactPath, signal)
    : readAabPackageNameAsync(artifactPath, signal));
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
  const stdout = await runManifestToolAsync('aapt2', ['dump', 'badging', artifactPath], signal);
  return parsePackageName(/package:\s+name='([^']+)'/m.exec(stdout)?.[1]);
}

async function readAabPackageNameAsync(artifactPath: string, signal: AbortSignal): Promise<string> {
  const stdout = await runManifestToolAsync(
    'bundletool',
    ['dump', 'manifest', '--bundle', artifactPath, '--xpath', '/manifest/@package'],
    signal
  );
  return parsePackageName(stdout.trim());
}

function parsePackageName(packageName: string | undefined): string {
  if (!packageName || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) {
    throw new UserError(
      'EAS_ANDROID_MANIFEST_INVALID',
      'Missing or invalid package name in the Android manifest.'
    );
  }
  return packageName;
}

async function runManifestToolAsync(
  command: string,
  args: string[],
  signal: AbortSignal
): Promise<string> {
  signal.throwIfAborted();
  const child = spawn(command, args, { stdio: 'pipe' });
  const abort = (): void => {
    child.child.kill('SIGKILL');
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const { stdout } = await child;
    signal.throwIfAborted();
    return stdout;
  } catch (error) {
    signal.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new SystemError(`${command} is not installed or is not available on the worker PATH.`, {
        cause: error,
      });
    }
    throw new UserError(
      'EAS_ANDROID_MANIFEST_INVALID',
      `Cannot read the Android manifest with ${command}. Check the app binary.`,
      { cause: error }
    );
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
