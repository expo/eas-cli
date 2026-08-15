import { Env } from '@expo/eas-build-job';
import fs from 'fs';
import path from 'path';

export const XCODE_CCACHE_COMPILER_LAUNCHER_ENV = 'EAS_BUILD_XCODE_CCACHE_COMPILER_LAUNCHER';
export const XCODE_CCACHE_COMPILER_LAUNCHER_SUPPORTED_ENV =
  '__EAS_BUILD_XCODE_CCACHE_COMPILER_LAUNCHER_SUPPORTED';

export function isXcodeCcacheCompilerLauncherSupported(xcodeVersionOutput: string): boolean {
  const majorVersion = xcodeVersionOutput.match(/^Xcode (\d+)/m)?.[1];
  return majorVersion !== undefined && Number(majorVersion) >= 26;
}

export function getXcodeCcacheCompilerLauncherEnv(
  env: Env,
  reactNativeProjectDirectory: string
): Env {
  const ccacheBinary = env.CCACHE_BINARY;
  if (
    env[XCODE_CCACHE_COMPILER_LAUNCHER_ENV] !== '1' ||
    env[XCODE_CCACHE_COMPILER_LAUNCHER_SUPPORTED_ENV] !== '1' ||
    !ccacheBinary ||
    /\s/.test(ccacheBinary)
  ) {
    return {};
  }

  const reactNativeCcacheConfigPath = path.join(
    reactNativeProjectDirectory,
    'node_modules',
    'react-native',
    'scripts',
    'xcode',
    'ccache.conf'
  );

  return {
    GYM_XCARGS: [
      env.GYM_XCARGS,
      `C_COMPILER_LAUNCHER=${ccacheBinary}`,
      'CLANG_ENABLE_EXPLICIT_MODULES_WITH_COMPILER_LAUNCHER=YES',
    ]
      .filter(Boolean)
      .join(' '),
    ...(!env.CCACHE_CONFIGPATH && fs.existsSync(reactNativeCcacheConfigPath)
      ? { CCACHE_CONFIGPATH: reactNativeCcacheConfigPath }
      : null),
  };
}
