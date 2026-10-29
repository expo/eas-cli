import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';

import { validateControllerVersion } from '../controllerVersion';

describe(validateControllerVersion, () => {
  const minimumVersion = '0.16.0';
  const controller = { packageName: 'example-controller', minimumVersion };
  const warn = jest.fn();
  const logger = { warn } as unknown as bunyan;
  const supportedVersion = '999.0.0';
  const oldVersion = '0.0.0';

  beforeEach(() => {
    warn.mockClear();
  });

  it('allows the default latest package version', () => {
    expect(() =>
      validateControllerVersion({ ...controller, packageVersion: undefined, logger })
    ).not.toThrow();
    expect(() =>
      validateControllerVersion({ ...controller, packageVersion: 'latest', logger })
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('allows exact supported semver versions', () => {
    expect(() =>
      validateControllerVersion({ ...controller, packageVersion: minimumVersion, logger })
    ).not.toThrow();
    expect(() =>
      validateControllerVersion({ ...controller, packageVersion: supportedVersion, logger })
    ).not.toThrow();
    expect(() =>
      validateControllerVersion({ ...controller, packageVersion: `v${supportedVersion}`, logger })
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects exact semver versions that are too old', () => {
    expect(() =>
      validateControllerVersion({ ...controller, packageVersion: oldVersion, logger })
    ).toThrow(SystemError);
    expect(() =>
      validateControllerVersion({ ...controller, packageVersion: oldVersion, logger })
    ).toThrow(`Use "latest" or pass an exact version >= ${minimumVersion}`);
  });

  it('warns for package tags or ranges that cannot be verified', () => {
    expect(() =>
      validateControllerVersion({ ...controller, packageVersion: 'next', logger })
    ).not.toThrow();
    expect(() =>
      validateControllerVersion({ ...controller, packageVersion: `^${minimumVersion}`, logger })
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Continuing and letting the package manager resolve it.')
    );
  });
});
