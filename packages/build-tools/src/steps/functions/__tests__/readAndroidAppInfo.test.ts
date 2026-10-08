import { SystemError, UserError } from '@expo/eas-build-job';
import spawn from '@expo/spawn-async';
import path from 'node:path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { readAndroidArtifactInfoAsync } from '../../utils/android/appArtifact';
import { createReadAndroidAppInfoBuildFunction } from '../readAndroidAppInfo';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');
jest.mock('@expo/spawn-async');

// These ZIPs contain only the entry needed for format detection. Native manifest
// tools are mocked, so the tests do not need an Android SDK or valid app binaries.
const fixturesDirectory = path.join(__dirname, 'fixtures/android-app-info');
const artifacts = [
  { type: 'apk', tool: 'aapt2', args: ['dump', 'packagename'] },
  { type: 'aab', tool: 'bundletool', args: ['dump', 'manifest', '--bundle'] },
];

beforeEach(() => {
  jest.mocked(spawn).mockReset();
});

it.each(artifacts)(
  'reads $type contents and publishes build step outputs',
  async ({ type, tool, args }) => {
    jest
      .mocked(spawn)
      .mockResolvedValue({ stdout: '  com.example.app\n' } as Awaited<ReturnType<typeof spawn>>);
    const step = createReadAndroidAppInfoBuildFunction().createBuildStepFromFunctionCall(
      createGlobalContextMock({
        projectTargetDirectory: fixturesDirectory,
        staticContextContent: { job: {} },
      }),
      { callInputs: { artifact_path: `${type}.zip` } }
    );

    await step.executeAsync();

    expect(step.outputById.artifact_type.value).toBe(type);
    expect(step.outputById.package_name.value).toBe('com.example.app');
    expect(spawn).toHaveBeenCalledWith(
      tool,
      [
        ...args,
        path.join(fixturesDirectory, `${type}.zip`),
        ...(type === 'aab' ? ['--xpath', '/manifest/@package'] : []),
      ],
      expect.objectContaining({ stdio: 'pipe' })
    );
  }
);

it('reports an invalid ZIP as a user error before invoking native tools', async () => {
  await expect(readAndroidArtifactInfoAsync(__filename)).rejects.toMatchObject({
    constructor: UserError,
    errorCode: 'EAS_READ_ANDROID_APP_INFO_INVALID_ARTIFACT',
    cause: expect.any(Error),
  });
  expect(spawn).not.toHaveBeenCalled();
});

it.each(artifacts)('retains the cause when the $type manifest tool fails', async ({ type }) => {
  const cause = new Error('Invalid manifest');
  jest.mocked(spawn).mockRejectedValue(cause);

  await expect(
    readAndroidArtifactInfoAsync(path.join(fixturesDirectory, `${type}.zip`))
  ).rejects.toMatchObject({
    constructor: UserError,
    errorCode: 'EAS_READ_ANDROID_APP_INFO_INVALID_MANIFEST',
    cause,
  });
});

it.each(artifacts)('reports a missing $tool as a system error', async ({ type, tool }) => {
  const cause = Object.assign(new Error('Not found'), { code: 'ENOENT' });
  jest.mocked(spawn).mockRejectedValue(cause);

  await expect(
    readAndroidArtifactInfoAsync(path.join(fixturesDirectory, `${type}.zip`))
  ).rejects.toMatchObject({
    constructor: SystemError,
    message: expect.stringContaining(tool),
    cause,
  });
});

it('preserves cancellation while a manifest tool is running', async () => {
  const controller = new AbortController();
  const reason = new Error('Cancelled');
  jest.mocked(spawn).mockImplementation(() => {
    controller.abort(reason);
    throw new Error('Process terminated');
  });

  await expect(
    readAndroidArtifactInfoAsync(path.join(fixturesDirectory, 'apk.zip'), controller.signal)
  ).rejects.toBe(reason);
  expect(spawn).toHaveBeenCalledWith(
    'aapt2',
    expect.any(Array),
    expect.objectContaining({ signal: controller.signal })
  );
});
