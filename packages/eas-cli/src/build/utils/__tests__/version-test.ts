import { bumpAppVersionAsync, getVersionConfigTarget } from '../version';
import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { updateAppJsonConfigAsync } from '../appJson';

jest.mock('../appJson', () => ({
  __esModule: true,
  updateAppJsonConfigAsync: jest.fn().mockImplementation(
    async (
      {
        exp,
      }: {
        projectDir: string;
        exp: ExpoConfig;
      },
      modifyConfig: (config: any) => void
    ) => {
      // a mocked implementation that only mutates the config object without writing to disk
      modifyConfig(exp);
    }
  ),
}));

describe(bumpAppVersionAsync, () => {
  const name = 'test';
  const slug = 'test';
  const projectDir = '/app';
  const mockUpdateAppJsonConfigAsync = updateAppJsonConfigAsync as jest.MockedFunction<
    typeof updateAppJsonConfigAsync
  >;

  it('should bump expo.version for valid semver', async () => {
    const appVersion = '1.0.0';
    const exp: ExpoConfig = {
      name,
      slug,
      version: appVersion,
    };

    await bumpAppVersionAsync({ appVersion, projectDir, exp, platform: Platform.IOS });
    expect(mockUpdateAppJsonConfigAsync).toHaveBeenCalled();
    expect(exp.version).toBe('1.0.1');
  });

  it('should bump expo.android.version if the expo.android.version exists', async () => {
    const exp: ExpoConfig = {
      name,
      slug,
      version: '0.0.0',
      android: {
        // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
        version: '1.0.0',
      },
      ios: {
        // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
        version: '2.0.0',
      },
    };

    await bumpAppVersionAsync({ appVersion: '1.0.0', projectDir, exp, platform: Platform.ANDROID });
    expect(mockUpdateAppJsonConfigAsync).toHaveBeenCalled();
    expect(exp.version).toBe('0.0.0');
    // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
    expect(exp.android.version).toBe('1.0.1');
    // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
    expect(exp.ios.version).toBe('2.0.0');
  });

  it('should bump expo.ios.version if the expo.ios.version exists', async () => {
    const exp: ExpoConfig = {
      name,
      slug,
      version: '0.0.0',
      android: {
        // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
        version: '1.0.0',
      },
      ios: {
        // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
        version: '2.0.0',
      },
    };

    await bumpAppVersionAsync({ appVersion: '2.0.0', projectDir, exp, platform: Platform.IOS });
    expect(mockUpdateAppJsonConfigAsync).toHaveBeenCalled();
    expect(exp.version).toBe('0.0.0');
    // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
    expect(exp.android.version).toBe('1.0.0');
    // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
    expect(exp.ios.version).toBe('2.0.1');
  });
});

describe(getVersionConfigTarget, () => {
  const exp: ExpoConfig = {
    name: 'test',
    slug: 'test',
    version: '0.0.0',
    android: {
      // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
      version: '1.0.0',
    },
    ios: {
      // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
      version: '2.0.0',
    },
  };

  it('should return the correct config target for the android platform', () => {
    const { fieldName, versionGetter, versionUpdater } = getVersionConfigTarget({
      exp,
      platform: Platform.ANDROID,
    });
    expect(fieldName).toBe('expo.android.version');
    expect(versionGetter(exp)).toBe('1.0.0');
    // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
    expect(versionUpdater(exp, '3.3.3').android.version).toBe('3.3.3');
    expect(versionUpdater(exp, '0.0.0').version).toBe('0.0.0');
  });

  it('should return the correct config target for the ios platform', () => {
    const { fieldName, versionGetter, versionUpdater } = getVersionConfigTarget({
      exp,
      platform: Platform.IOS,
    });
    expect(fieldName).toBe('expo.ios.version');
    expect(versionGetter(exp)).toBe('2.0.0');
    // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
    expect(versionUpdater(exp, '3.3.3').ios.version).toBe('3.3.3');
    expect(versionUpdater(exp, '0.0.0').version).toBe('0.0.0');
  });

  it('should return the correct config target for common version', () => {
    const exp: ExpoConfig = {
      name: 'test',
      slug: 'test',
      version: '0.0.0',
    };
    const { fieldName, versionGetter, versionUpdater } = getVersionConfigTarget({
      exp,
      platform: Platform.IOS,
    });
    expect(fieldName).toBe('expo.version');
    expect(versionGetter(exp)).toBe('0.0.0');
    expect(versionUpdater(exp, '3.3.3').version).toBe('3.3.3');
  });
});
