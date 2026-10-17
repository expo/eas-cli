import { UserError } from '@expo/eas-build-job';
import path from 'node:path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { readAndroidArtifactInfoAsync } from '../../utils/android/appArtifact';
import { createReadAndroidAppInfoBuildFunction } from '../readAndroidAppInfo';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');
jest.unmock('@expo/spawn-async');

const fixturesDirectory = path.join(__dirname, 'fixtures/android-app-info');

it.each(['apk', 'aab'])('reads a real %s and publishes build step outputs', async type => {
  const step = createReadAndroidAppInfoBuildFunction().createBuildStepFromFunctionCall(
    createGlobalContextMock({
      projectTargetDirectory: fixturesDirectory,
      staticContextContent: { job: {} },
    }),
    { callInputs: { artifact_path: `app.${type}` } }
  );

  await step.executeAsync();

  expect(step.outputById.artifact_type.value).toBe(type);
  expect(step.outputById.package_name.value).toBe('com.example.app');
});

it('reports an invalid ZIP as a user error', async () => {
  await expect(readAndroidArtifactInfoAsync(__filename)).rejects.toMatchObject({
    constructor: UserError,
    errorCode: 'EAS_READ_ANDROID_APP_INFO_INVALID_ARTIFACT',
    cause: expect.any(Error),
  });
});

it.each(['apk', 'aab'])('retains the native tool error for an invalid %s manifest', async type => {
  await expect(
    readAndroidArtifactInfoAsync(path.join(fixturesDirectory, `invalid-manifest-${type}.zip`))
  ).rejects.toMatchObject({
    constructor: UserError,
    errorCode: 'EAS_READ_ANDROID_APP_INFO_INVALID_MANIFEST',
    cause: expect.any(Error),
  });
});
