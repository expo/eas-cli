import { randomBytes, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createTestIosJob } from '../../../__tests__/utils/job';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { BuildContext } from '../../../context';
import { CustomBuildContext } from '../../../customBuildContext';
import { createUploadArtifactBuildFunction } from '../uploadArtifact';

describe(createUploadArtifactBuildFunction, () => {
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
  const uploadArtifact = createUploadArtifactBuildFunction(customContext);

  it.each(['build-artifact', 'BUILD_ARTIFACTS'])('accepts %s', async (type) => {
    const buildStep = uploadArtifact.createBuildStepFromFunctionCall(createGlobalContextMock({}), {
      callInputs: {
        type,
        path: '/',
      },
    });
    const typeInput = buildStep.inputs?.find((input) => input.id === 'type')!;
    expect(typeInput.isRawValueOneOfAllowedValues()).toBe(true);
  });

  it('accepts `path` argument', async () => {
    const buildStep = uploadArtifact.createBuildStepFromFunctionCall(createGlobalContextMock({}), {
      callInputs: {
        type: 'build-artifact',
        path: '/',
      },
    });
    await expect(buildStep.executeAsync()).resolves.not.toThrowError();
  });

  it('accepts multiline `path` argument', async () => {
    const globalContext = createGlobalContextMock({});
    const tempDir = globalContext.defaultWorkingDirectory;

    const debugPath = path.join(tempDir, 'Build', 'Products', 'Debug-iphonesimulator');
    const debugArtifactPath = path.join(debugPath, 'release-artifact.app');

    const releasePath = path.join(tempDir, 'Build', 'Products', 'Release-iphonesimulator');
    const releaseArtifactPath = path.join(releasePath, 'release-artifact.app');

    const directArtifactPath = path.join(tempDir, 'artifact.ipa');

    try {
      await fs.promises.mkdir(debugPath, {
        recursive: true,
      });
      await fs.promises.writeFile(debugArtifactPath, randomBytes(10));

      await fs.promises.mkdir(releasePath, {
        recursive: true,
      });
      await fs.promises.writeFile(releaseArtifactPath, randomBytes(10));

      await fs.promises.writeFile(directArtifactPath, randomBytes(10));

      const buildStep = uploadArtifact.createBuildStepFromFunctionCall(globalContext, {
        callInputs: {
          type: 'build-artifact',
          path: [
            path.join('Build', 'Products', '*simulator', '*.app'),
            path.relative(tempDir, directArtifactPath),
          ].join('\n'),
        },
      });

      await buildStep.executeAsync();

      expect(contextUploadArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          artifact: expect.objectContaining({
            paths: expect.arrayContaining([
              debugArtifactPath,
              releaseArtifactPath,
              directArtifactPath,
            ]),
          }),
        })
      );
    } finally {
      for (const path of [directArtifactPath, debugPath, releasePath]) {
        await fs.promises.rm(path, { recursive: true, force: true });
      }
    }
  });

  it('does not throw for undefined type input', async () => {
    const buildStep = uploadArtifact.createBuildStepFromFunctionCall(createGlobalContextMock({}), {
      callInputs: {
        path: '/',
      },
    });
    for (const input of buildStep.inputs ?? []) {
      expect(input.isRawValueOneOfAllowedValues()).toBe(true);
    }
  });

  it.each(['invalid-value'])('does not accept %s', async (type) => {
    const buildStep = uploadArtifact.createBuildStepFromFunctionCall(createGlobalContextMock({}), {
      callInputs: {
        type,
        path: '/',
      },
    });
    const typeInput = buildStep.inputs?.find((input) => input.id === 'type')!;
    expect(typeInput.isRawValueOneOfAllowedValues()).toBe(false);
  });
});
