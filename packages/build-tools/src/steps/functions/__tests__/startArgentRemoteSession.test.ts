import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { spawnSync } from 'node:child_process';

import {
  MIN_ARGENT_REMOTE_SESSION_VERSION,
  resolveArgentInvocation,
  resolveLocalArgentBin,
  warnIfArgentPackageVersionCannotBeVerified,
} from '../startArgentRemoteSession';

jest.mock('node:child_process', () => ({
  spawnSync: jest.fn(),
}));

const mockedSpawnSync = jest.mocked(spawnSync);

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

describe(resolveArgentInvocation, () => {
  it('runs the local binary directly when one is provided', () => {
    expect(
      resolveArgentInvocation({ localArgentBin: '/usr/local/bin/argent', versionSpec: '1.2.3' })
    ).toEqual({ command: '/usr/local/bin/argent', packageArgs: [] });
  });

  it('fetches the pinned package via bunx when there is no local binary', () => {
    expect(resolveArgentInvocation({ localArgentBin: null, versionSpec: '1.2.3' })).toEqual({
      command: 'bunx',
      packageArgs: ['@swmansion/argent@1.2.3'],
    });
  });
});

describe(resolveLocalArgentBin, () => {
  it('returns the resolved path when argent is on PATH', () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: '/usr/local/bin/argent\n' } as ReturnType<
      typeof spawnSync
    >);
    expect(resolveLocalArgentBin()).toBe('/usr/local/bin/argent');
  });

  it('returns null when argent is not on PATH', () => {
    mockedSpawnSync.mockReturnValue({ status: 1, stdout: '' } as ReturnType<typeof spawnSync>);
    expect(resolveLocalArgentBin()).toBeNull();
  });
});
