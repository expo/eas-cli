import { type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import semver from 'semver';
import { z } from 'zod';

const PackageNames = {
  'serve-sim': '@expo/serve-sim',
  'agent-device': 'agent-device',
  argent: '@swmansion/argent',
  appium: 'appium',
};

/** Resolve an explicit request once, so comparison and installation use the same version. */
export async function resolveSimulatorPackageVersionAsync(
  engine: keyof typeof PackageNames,
  requested: string,
  { env, signal }: { env: BuildStepEnv; signal?: AbortSignal }
): Promise<string> {
  signal?.throwIfAborted();
  const exact = semver.parse(requested);
  if (exact) {
    return exact.version + (exact.build.length ? `+${exact.build.join('.')}` : '');
  }
  // Use npm's configured registry and revalidate metadata instead of trusting a cached dist-tag.
  const { stdout } = await spawn(
    'npm',
    [
      'view',
      `${PackageNames[engine]}@${requested}`,
      'version',
      '--json',
      '--prefer-online',
      '--prefer-offline=false',
      '--offline=false',
      '--fetch-retries=0',
    ],
    { env, signal, stdio: 'pipe', timeout: 30_000 }
  );
  signal?.throwIfAborted();
  const version = z.string().refine(value => semver.valid(value) !== null);
  const versions = z.union([version, z.array(version)]).parse(JSON.parse(stdout));
  const candidates = typeof versions === 'string' ? [versions] : versions;
  const resolved = semver.rsort(candidates)[0];
  if (!resolved) {
    throw new Error(`Could not resolve the requested ${engine} package version.`);
  }
  return resolved;
}
