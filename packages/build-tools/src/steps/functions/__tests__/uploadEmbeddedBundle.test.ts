import { ProjectConfig } from '@expo/config';
import { BuildJob } from '@expo/eas-build-job';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createTestAndroidJob } from '../../../__tests__/utils/job';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { BuildContext } from '../../../context';
import { CustomBuildContext } from '../../../customBuildContext';
import { readAppConfig } from '../../../utils/appConfig';
import { uploadEmbeddedBundleAsync } from '../../../utils/expoUpdatesEmbedded';
import { createUploadEmbeddedBundleBuildFunction } from '../uploadEmbeddedBundle';

jest.mock('../../../utils/appConfig');
jest.mock('../../../utils/expoUpdatesEmbedded');

function mockAppConfig(updatesUrl: string | undefined): void {
  jest.mocked(readAppConfig).mockResolvedValue({
    exp: { name: 'my-app', slug: 'my-app', updates: updatesUrl ? { url: updatesUrl } : undefined },
  } as ProjectConfig);
}

function createCustomContext(job: BuildJob): CustomBuildContext<BuildJob> {
  return new CustomBuildContext(
    new BuildContext(job, {
      env: { __API_SERVER_URL: 'http://api.expo.test' },
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger: createMockLogger(),
      uploadArtifact: jest.fn(),
      workingdir: '',
    })
  );
}

describe(createUploadEmbeddedBundleBuildFunction, () => {
  const job = createTestAndroidJob({});
  const customContext = createCustomContext(job);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('uploads the embedded bundle from the working directory', async () => {
    mockAppConfig('https://u.expo.dev/project-id');
    const globalContext = createGlobalContextMock({});
    globalContext.updateEnv({ EAS_BUILD_ID: 'build-123' });
    const buildStep =
      createUploadEmbeddedBundleBuildFunction(customContext).createBuildStepFromFunctionCall(
        globalContext
      );

    await buildStep.executeAsync();

    expect(uploadEmbeddedBundleAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        job,
        env: expect.objectContaining({ EAS_BUILD_ID: 'build-123' }),
        projectDir: globalContext.defaultWorkingDirectory,
        appConfig: expect.objectContaining({ updates: { url: 'https://u.expo.dev/project-id' } }),
      })
    );
  });

  it('logs when the embedded bundle upload is skipped', async () => {
    mockAppConfig('https://u.expo.dev/project-id');
    jest.mocked(uploadEmbeddedBundleAsync).mockResolvedValue('skipped');
    const buildStep = createUploadEmbeddedBundleBuildFunction(
      customContext
    ).createBuildStepFromFunctionCall(createGlobalContextMock({}));

    await buildStep.executeAsync();

    expect(buildStep.ctx.logger.info).toHaveBeenCalledWith('Skipping embedded bundle upload.');
  });

  it('does not fail the step when the app config cannot be read', async () => {
    jest.mocked(readAppConfig).mockRejectedValue(new Error('Invalid app config'));
    const buildStep = createUploadEmbeddedBundleBuildFunction(
      customContext
    ).createBuildStepFromFunctionCall(createGlobalContextMock({}));

    await buildStep.executeAsync();

    expect(buildStep.ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to upload embedded bundle.'
    );
    expect(uploadEmbeddedBundleAsync).not.toHaveBeenCalled();
  });
});
