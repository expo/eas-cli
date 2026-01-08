import resolveFrom from 'resolve-from';
import spawnAsync from '@expo/turtle-spawn';
import { BuildStepEnv } from '@expo/steps';
import fs from 'fs-extra';
import semver from 'semver';

export class ExpoFingerprintCLIModuleNotFoundError extends Error {}
export class ExpoFingerprintCLIInvalidCommandError extends Error {}
export class ExpoFingerprintCLICommandFailedError extends Error {}

function resolveExpoFingerprintCLI(projectRoot: string): string {
  const expoPackageRoot = resolveFrom.silent(projectRoot, 'expo/package.json');
  try {
    return (
      resolveFrom.silent(expoPackageRoot ?? projectRoot, '@expo/fingerprint/bin/cli') ??
      resolveFrom(expoPackageRoot ?? projectRoot, '@expo/fingerprint/bin/cli.js')
    );
  } catch (e: any) {
    if (e.code === 'MODULE_NOT_FOUND') {
      throw new ExpoFingerprintCLIModuleNotFoundError(
        `The \`@expo/fingerprint\` package was not found.`
      );
    }
    throw e;
  }
}

export async function expoFingerprintCommandAsync(
  projectDir: string,
  args: string[],
  { env }: { env: BuildStepEnv }
): Promise<string> {
  const expoFingerprintCli = resolveExpoFingerprintCLI(projectDir);
  try {
    const spawnResult = await spawnAsync(expoFingerprintCli, args, {
      stdio: 'pipe',
      cwd: projectDir,
      env,
    });
    return spawnResult.stdout;
  } catch (e: any) {
    if (e.stderr && typeof e.stderr === 'string') {
      if (e.stderr.includes('Invalid command')) {
        throw new ExpoFingerprintCLIInvalidCommandError(
          `The command specified by ${args} was not valid in the \`@expo/fingerprint\` CLI.`
        );
      } else {
        throw new ExpoFingerprintCLICommandFailedError(e.stderr);
      }
    }
    throw e;
  }
}

async function getExpoFingerprintPackageVersionIfInstalledAsync(
  projectDir: string
): Promise<string | null> {
  const expoPackageRoot = resolveFrom.silent(projectDir, 'expo/package.json');
  const maybePackageJson = resolveFrom.silent(
    expoPackageRoot ?? projectDir,
    '@expo/fingerprint/package.json'
  );
  if (!maybePackageJson) {
    return null;
  }
  const { version } = await fs.readJson(maybePackageJson);
  return version ?? null;
}

export async function isModernExpoFingerprintCLISupportedAsync(
  projectDir: string
): Promise<boolean> {
  const expoFingerprintPackageVersion =
    await getExpoFingerprintPackageVersionIfInstalledAsync(projectDir);
  if (!expoFingerprintPackageVersion) {
    return false;
  }

  if (expoFingerprintPackageVersion.includes('canary')) {
    return true;
  }

  return semver.gte(expoFingerprintPackageVersion, '0.11.2');
}
