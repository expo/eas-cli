import { BuildMode } from '@expo/eas-build-job';
import { vol } from 'memfs';

import { createTestBuildContext } from '../../__tests__/utils/context';
import {
  createTestIosJob,
  createTestXcodeJob,
  createTestXcodeSimulatorJob,
} from '../../__tests__/utils/job';
import { prepareProjectSourcesAsync } from '../../common/projectSources';
import { runBuilderWithHooksAsync } from '../common';
import { runCustomBuildAsync } from '../custom';
import iosBuilder from '../ios';

jest.mock('../common', () => ({ runBuilderWithHooksAsync: jest.fn(async () => ({})) }));
jest.mock('../custom', () => ({ runCustomBuildAsync: jest.fn(async () => ({})) }));
jest.mock('../../common/projectSources');
jest.mock('../../ios/xcodeBuildLogs');
jest.mock('../../utils/prepareBuildExecutable', () => ({ prepareExecutableAsync: jest.fn() }));

afterEach(() => {
  vol.reset();
});

describe(iosBuilder, () => {
  it.each([
    ['an unknown builder', { builder: 'unknown' }, '"builder" must be [xcode]'],
    ['a builder and the custom mode', { mode: BuildMode.CUSTOM }, '"mode" must be [build]'],
    ['a builder and the resign mode', { mode: BuildMode.RESIGN }, '"mode" must be [build]'],
    ['a builder and the repack mode', { mode: BuildMode.REPACK }, '"mode" must be [build]'],
  ])(
    'fails a job with %s in the validation of the Xcode runner',
    async (_description, overrides, expectedMessage) => {
      await expect(
        iosBuilder(createTestBuildContext(createTestXcodeJob(overrides)))
      ).rejects.toMatchObject({
        trackingCode: 'NATIVE_INVALID_JOB',
        message: expect.stringContaining(expectedMessage),
      });
      expect(runCustomBuildAsync).not.toHaveBeenCalled();
      expect(runBuilderWithHooksAsync).not.toHaveBeenCalled();
      expect(prepareProjectSourcesAsync).not.toHaveBeenCalled();
    }
  );

  it('runs a valid job with the Xcode builder through the Xcode steps', async () => {
    jest.mocked(prepareProjectSourcesAsync).mockImplementation(async () => {
      vol.mkdirSync('/workingdir/env', { recursive: true });
      vol.fromJSON({ 'README.md': '' }, '/workingdir/temporary-custom-build');
      return { handled: true };
    });
    const ctx = createTestBuildContext(createTestXcodeSimulatorJob());

    await expect(iosBuilder(ctx)).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_PROJECT_FILE_NOT_FOUND',
    });
    expect(runBuilderWithHooksAsync).not.toHaveBeenCalled();
  });

  it('routes a job without a builder by its mode', async () => {
    await iosBuilder(createTestBuildContext(createTestIosJob()));
    expect(runBuilderWithHooksAsync).toHaveBeenCalledTimes(1);

    await iosBuilder(createTestBuildContext({ ...createTestIosJob(), mode: BuildMode.CUSTOM }));
    expect(runCustomBuildAsync).toHaveBeenCalledTimes(1);
  });
});
