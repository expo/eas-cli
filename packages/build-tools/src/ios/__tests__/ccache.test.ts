import {
  XCODE_CCACHE_COMPILER_LAUNCHER_ENV,
  XCODE_CCACHE_COMPILER_LAUNCHER_SUPPORTED_ENV,
  getXcodeCcacheCompilerLauncherEnv,
  isXcodeCcacheCompilerLauncherSupported,
} from '../ccache';
import { vol } from 'memfs';

const PROJECT_DIRECTORY = '/workingdir/build';

describe(isXcodeCcacheCompilerLauncherSupported, () => {
  it.each([
    ['Xcode 26.0\nBuild version 17A123', true],
    ['Xcode 26.6\nBuild version 17F113', true],
    ['Xcode 27\nBuild version 18A123', true],
    ['Xcode 25.4\nBuild version 16F6', false],
    ['unexpected output', false],
  ])('returns the expected result for %j', (versionOutput, expected) => {
    expect(isXcodeCcacheCompilerLauncherSupported(versionOutput)).toBe(expected);
  });
});

describe(getXcodeCcacheCompilerLauncherEnv, () => {
  const enabledEnv = {
    [XCODE_CCACHE_COMPILER_LAUNCHER_ENV]: '1',
    [XCODE_CCACHE_COMPILER_LAUNCHER_SUPPORTED_ENV]: '1',
    CCACHE_BINARY: '/opt/homebrew/bin/ccache',
  };

  it('uses ccache as the Xcode compiler launcher and enables explicit modules', () => {
    expect(getXcodeCcacheCompilerLauncherEnv(enabledEnv, PROJECT_DIRECTORY)).toEqual({
      GYM_XCARGS:
        'C_COMPILER_LAUNCHER=/opt/homebrew/bin/ccache CLANG_ENABLE_EXPLICIT_MODULES_WITH_COMPILER_LAUNCHER=YES',
    });
  });

  it('preserves existing Gym Xcode arguments', () => {
    expect(
      getXcodeCcacheCompilerLauncherEnv(
        { ...enabledEnv, GYM_XCARGS: 'OTHER_SETTING=YES' },
        PROJECT_DIRECTORY
      )
    ).toEqual({
      GYM_XCARGS:
        'OTHER_SETTING=YES C_COMPILER_LAUNCHER=/opt/homebrew/bin/ccache CLANG_ENABLE_EXPLICIT_MODULES_WITH_COMPILER_LAUNCHER=YES',
    });
  });

  it("preserves React Native's ccache configuration", () => {
    const ccacheConfigPath = `${PROJECT_DIRECTORY}/node_modules/react-native/scripts/xcode/ccache.conf`;
    vol.fromJSON({ [ccacheConfigPath]: 'depend_mode = true' });

    expect(getXcodeCcacheCompilerLauncherEnv(enabledEnv, PROJECT_DIRECTORY)).toEqual({
      GYM_XCARGS:
        'C_COMPILER_LAUNCHER=/opt/homebrew/bin/ccache CLANG_ENABLE_EXPLICIT_MODULES_WITH_COMPILER_LAUNCHER=YES',
      CCACHE_CONFIGPATH: ccacheConfigPath,
    });
  });

  it.each([
    [{ ...enabledEnv, [XCODE_CCACHE_COMPILER_LAUNCHER_ENV]: '0' }],
    [{ ...enabledEnv, [XCODE_CCACHE_COMPILER_LAUNCHER_SUPPORTED_ENV]: '0' }],
    [{ ...enabledEnv, CCACHE_BINARY: undefined }],
    [{ ...enabledEnv, CCACHE_BINARY: '/Applications/Build Tools/ccache' }],
  ])('does not change the build when the launcher cannot be used', env => {
    expect(getXcodeCcacheCompilerLauncherEnv(env, PROJECT_DIRECTORY)).toEqual({});
  });
});
