import { SystemError } from '@expo/eas-build-job';

export function isNpmCacheInstallFailure(err: unknown, npmCacheUrl: string): boolean {
  return getErrorOutput(err).includes(npmCacheUrl);
}

function getErrorOutput(err: unknown): string {
  if (!(err instanceof Error)) {
    return '';
  }
  const { stdout, stderr } = err as Error & { stdout?: string; stderr?: string };
  return [stdout, stderr].filter(Boolean).join('\n');
}

export class NpmCacheRegistryInstallError extends SystemError {
  override name = 'NpmCacheRegistryInstallError';
  constructor(cause: unknown) {
    super('Failed to install dependencies using npm cache registry', { cause });
  }
}
