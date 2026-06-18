import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';

import { warnIfArgentPackageVersionCannotBeVerified } from '../startArgentRemoteSession';

describe(warnIfArgentPackageVersionCannotBeVerified, () => {
  const warn = jest.fn();
  const logger = { warn } as unknown as bunyan;

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
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: '0.11.0', logger })
    ).not.toThrow();
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: '0.11.1', logger })
    ).not.toThrow();
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: 'v0.11.1', logger })
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects exact semver versions that are too old', () => {
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: '0.10.9', logger })
    ).toThrow(SystemError);
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: '0.10.9', logger })
    ).toThrow(/Use "latest" or pass an exact version >= 0\.11\.0/);
  });

  it('warns for package tags or ranges that cannot be verified', () => {
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: 'next', logger })
    ).not.toThrow();
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: '^0.11.0', logger })
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Continuing and letting bunx resolve it.')
    );
  });
});
