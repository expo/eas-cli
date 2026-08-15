import spawn from '@expo/turtle-spawn';

import {
  XCODE_CCACHE_COMPILER_LAUNCHER_ENV,
  XCODE_CCACHE_COMPILER_LAUNCHER_SUPPORTED_ENV,
} from '../../../../ios/ccache';
import { runFastlaneGym } from '../fastlane';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../../common/xcpretty', () => ({
  XcodeBuildLogger: jest.fn().mockImplementation(() => ({
    watchLogFiles: jest.fn(),
    flush: jest.fn(),
  })),
}));

describe(runFastlaneGym, () => {
  it('adds the opted-in ccache compiler launcher to a custom build', async () => {
    await runFastlaneGym({
      workingDir: '/workingdir',
      buildLogsDirectory: '/logs',
      logger: {} as any,
      env: {
        [XCODE_CCACHE_COMPILER_LAUNCHER_ENV]: '1',
        [XCODE_CCACHE_COMPILER_LAUNCHER_SUPPORTED_ENV]: '1',
        CCACHE_BINARY: '/opt/homebrew/bin/ccache',
        GYM_XCARGS: 'OTHER_SETTING=YES',
      },
    });

    expect(spawn).toHaveBeenCalledWith(
      'fastlane',
      ['gym'],
      expect.objectContaining({
        env: expect.objectContaining({
          GYM_XCARGS:
            'OTHER_SETTING=YES C_COMPILER_LAUNCHER=/opt/homebrew/bin/ccache CLANG_ENABLE_EXPLICIT_MODULES_WITH_COMPILER_LAUNCHER=YES',
        }),
      })
    );
  });
});
