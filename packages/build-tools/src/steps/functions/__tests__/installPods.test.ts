import spawn from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { waitForThirdPartyPrecompiledModulesPreparationAsync } from '../../../utils/precompiledModules';
import { createInstallPodsBuildFunction } from '../installPods';

jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/precompiledModules', () => ({
  ...jest.requireActual('../../../utils/precompiledModules'),
  waitForThirdPartyPrecompiledModulesPreparationAsync: jest.fn(),
}));

describe(createInstallPodsBuildFunction, () => {
  it('waits for third-party precompiled dependencies before running pod install', async () => {
    jest.mocked(spawn).mockResolvedValue({} as any);
    jest.mocked(waitForThirdPartyPrecompiledModulesPreparationAsync).mockResolvedValue(undefined);

    const installPods = createInstallPodsBuildFunction();
    const globalContext = createGlobalContextMock({});
    const buildStep = installPods.createBuildStepFromFunctionCall(globalContext, {
      callInputs: {},
    });

    await buildStep.executeAsync();

    expect(waitForThirdPartyPrecompiledModulesPreparationAsync).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      'pod',
      ['install'],
      expect.objectContaining({
        cwd: globalContext.defaultWorkingDirectory,
      })
    );
  });

  it('continues with pod install when third-party precompiled dependencies preparation fails', async () => {
    jest.mocked(spawn).mockResolvedValue({} as any);
    jest
      .mocked(waitForThirdPartyPrecompiledModulesPreparationAsync)
      .mockRejectedValue(new Error('third-party precompiled dependencies failed'));

    const installPods = createInstallPodsBuildFunction();
    const globalContext = createGlobalContextMock({});
    const buildStep = installPods.createBuildStepFromFunctionCall(globalContext, {
      callInputs: {},
    });

    await expect(buildStep.executeAsync()).resolves.toBeUndefined();

    expect(waitForThirdPartyPrecompiledModulesPreparationAsync).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      'pod',
      ['install'],
      expect.objectContaining({
        cwd: globalContext.defaultWorkingDirectory,
      })
    );
  });
});
