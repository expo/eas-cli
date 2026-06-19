import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';

import {
  MIN_ARGENT_REMOTE_SESSION_VERSION,
  warnIfArgentPackageVersionCannotBeVerified,
} from '../startArgentRemoteSession';

describe(warnIfArgentPackageVersionCannotBeVerified, () => {
  const warn = jest.fn();
  const logger = { warn } as unknown as bunyan;
  const supportedVersion = '999.0.0';
  const oldVersion = '0.0.0';

  beforeEach(() => {
    warn.mockClear();
  });

  it('allows the default latest package version', () => {
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: undefined, logger })
    ).not.toThrow();
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: 'latest', logger })
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('allows exact supported semver versions', () => {
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({
        packageVersion: MIN_ARGENT_REMOTE_SESSION_VERSION,
        logger,
      })
    ).not.toThrow();
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: supportedVersion, logger })
    ).not.toThrow();
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({
        packageVersion: `v${supportedVersion}`,
        logger,
      })
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects exact semver versions that are too old', () => {
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: oldVersion, logger })
    ).toThrow(SystemError);
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: oldVersion, logger })
    ).toThrow(`Use "latest" or pass an exact version >= ${MIN_ARGENT_REMOTE_SESSION_VERSION}`);
  });

  it('warns for package tags or ranges that cannot be verified', () => {
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: 'next', logger })
    ).not.toThrow();
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({
        packageVersion: `^${MIN_ARGENT_REMOTE_SESSION_VERSION}`,
        logger,
      })
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Continuing and letting bunx resolve it.')
    );
  });
});
