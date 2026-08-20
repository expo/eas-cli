import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { createInstallMaestroBuildFunction, installIdbFromBrew } from '../installMaestro';

jest.unmock('fs');
jest.unmock('@expo/logger');

describe('createInstallMaestroBuildFunction', () => {
  it('should resolve with no parameters', async () => {
    const installMaestro = createInstallMaestroBuildFunction();
    const logger = createMockLogger({ logToConsole: true });

    const anyVersionStep = installMaestro.createBuildStepFromFunctionCall(
      createGlobalContextMock({ logger }),
      {
        env: {
          ...process.env,
          EAS_BUILD_RUNNER: 'eas-build',
        },
        callInputs: {},
      }
    );

    await expect(anyVersionStep.executeAsync()).resolves.not.toThrow();
    console.log(anyVersionStep.outputs[0].value);

    const downgradeStep = installMaestro.createBuildStepFromFunctionCall(
      createGlobalContextMock({ logger }),
      {
        env: {
          ...process.env,
          EAS_BUILD_RUNNER: 'eas-build',
        },
        callInputs: {
          maestro_version: '1.40.0',
        },
      }
    );

    await expect(downgradeStep.executeAsync()).resolves.not.toThrow();
    expect(downgradeStep.outputById.maestro_version.value).toBe('1.40.0');

    const latestStep = installMaestro.createBuildStepFromFunctionCall(
      createGlobalContextMock({ logger }),
      {
        env: {
          ...process.env,
          EAS_BUILD_RUNNER: 'eas-build',
        },
        callInputs: {
          maestro_version: 'latest',
        },
      }
    );

    await expect(latestStep.executeAsync()).resolves.not.toThrow();
    console.log(latestStep.outputs[0].value);
  }, 180_000);
});

describe('installIdbFromBrew', () => {
  it('installs 1.1.8 version', async () => {
    const logger = createMockLogger({ logToConsole: true });

    await installIdbFromBrew({
      logger,
      env: process.env,
    });
  });
});
