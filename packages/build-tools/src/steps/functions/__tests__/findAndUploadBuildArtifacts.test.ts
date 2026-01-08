import { randomUUID } from 'crypto';

import { ManagedArtifactType } from '@expo/eas-build-job';
import { vol } from 'memfs';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createTestIosJob } from '../../../__tests__/utils/job';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { BuildContext } from '../../../context';
import { CustomBuildContext } from '../../../customBuildContext';
import { createFindAndUploadBuildArtifactsBuildFunction } from '../findAndUploadBuildArtifacts';

jest.mock('fs');

describe(createFindAndUploadBuildArtifactsBuildFunction, () => {
  const contextUploadArtifact = jest.fn(async () => ({ artifactId: randomUUID() }));
  const ctx = new BuildContext(createTestIosJob({}), {
    env: {
      __API_SERVER_URL: 'http://api.expo.test',
    },
    logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
    logger: createMockLogger(),
    uploadArtifact: contextUploadArtifact,
    workingdir: '',
  });
  const customContext = new CustomBuildContext(ctx);
  const findAndUploadBuildArtifacts = createFindAndUploadBuildArtifactsBuildFunction(customContext);

  it('throws first error', async () => {
    const globalContext = createGlobalContextMock({});
    const buildStep = findAndUploadBuildArtifacts.createBuildStepFromFunctionCall(
      globalContext,
      {}
    );

    await expect(buildStep.executeAsync()).rejects.toThrow('There are no files matching pattern');
  });

  it('does not throw error if it uploads artifact', async () => {
    const globalContext = createGlobalContextMock({});
    vol.fromJSON(
      {
        'ios/build/test.ipa': '',
      },
      globalContext.defaultWorkingDirectory
    );
    const buildStep = findAndUploadBuildArtifacts.createBuildStepFromFunctionCall(
      globalContext,
      {}
    );

    await expect(buildStep.executeAsync()).resolves.not.toThrow();
  });

  it('throws build artifacts error', async () => {
    const globalContext = createGlobalContextMock({});
    ctx.job.buildArtifactPaths = ['worker.log'];
    vol.fromJSON(
      {
        'ios/build/test.ipa': '',
      },
      globalContext.defaultWorkingDirectory
    );
    const buildStep = findAndUploadBuildArtifacts.createBuildStepFromFunctionCall(
      globalContext,
      {}
    );

    await expect(buildStep.executeAsync()).rejects.toThrow('No such file or directory worker.log');
  });

  it('upload build artifacts and throws application archive error', async () => {
    const globalContext = createGlobalContextMock({});
    ctx.job.buildArtifactPaths = ['worker.log'];
    vol.fromJSON(
      {
        'worker.log': '',
      },
      globalContext.defaultWorkingDirectory
    );
    const buildStep = findAndUploadBuildArtifacts.createBuildStepFromFunctionCall(
      globalContext,
      {}
    );
    await expect(buildStep.executeAsync()).rejects.toThrow('There are no files matching pattern');
    expect(contextUploadArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact: expect.objectContaining({
          type: ManagedArtifactType.BUILD_ARTIFACTS,
        }),
      })
    );
  });
});
