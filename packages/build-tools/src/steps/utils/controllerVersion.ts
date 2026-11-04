import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import semver from 'semver';

export function validateControllerVersion({
  packageName,
  minimumVersion,
  packageVersion,
  logger,
}: {
  packageName: string;
  minimumVersion: string;
  packageVersion: string | undefined;
  logger: bunyan;
}): void {
  if (!packageVersion || packageVersion === 'latest') {
    return;
  }
  const requirement = `Remote sessions require ${packageName}@${minimumVersion} or newer.`;
  const version = semver.valid(packageVersion);
  if (!version) {
    logger.warn(
      `${requirement} package_version "${packageVersion}" is not an exact semver version that EAS can verify. ` +
        'Continuing and letting the package manager resolve it.'
    );
    return;
  }
  if (semver.lt(version, minimumVersion)) {
    throw new SystemError(
      `${requirement} The requested package_version "${packageVersion}" is too old for the EAS remote-session API. ` +
        `Use "latest" or pass an exact version >= ${minimumVersion}.`
    );
  }
}
