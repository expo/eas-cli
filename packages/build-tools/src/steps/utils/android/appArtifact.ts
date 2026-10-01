import { UserError } from '@expo/eas-build-job';
import spawn from '@expo/spawn-async';

export type AndroidArtifactType = 'apk' | 'aab';

export async function readAndroidArtifactInfoAsync(
  artifactPath: string,
  signal: AbortSignal = AbortSignal.timeout(60_000)
): Promise<{ artifactPath: string; artifactType: AndroidArtifactType; packageName: string }> {
  for (const artifactType of ['apk', 'aab'] as const) {
    try {
      const packageName = await readAndroidPackageNameAsync(artifactPath, artifactType, signal);
      return { artifactPath, artifactType, packageName };
    } catch {
      signal.throwIfAborted();
    }
  }
  throw new UserError(
    'EAS_ANDROID_MANIFEST_INVALID',
    'Cannot read the artifact as an APK or AAB. Check the binary and ensure aapt2 and bundletool are installed on the worker.'
  );
}

async function readAndroidPackageNameAsync(
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
