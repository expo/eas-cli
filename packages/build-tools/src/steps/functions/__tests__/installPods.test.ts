import spawn from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { waitForPrecompiledModulesPreparationAsync } from '../../../utils/precompiledModules';
import { createInstallPodsBuildFunction } from '../installPods';

jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/precompiledModules', () => ({
  ...jest.requireActual('../../../utils/precompiledModules'),
  waitForPrecompiledModulesPreparationAsync: jest.fn(),
}));

describe(createInstallPodsBuildFunction, () => {
  it('waits for precompiled dependencies before running pod install', async () => {
    jest.mocked(spawn).mockResolvedValue({} as any);
    jest.mocked(waitForPrecompiledModulesPreparationAsync).mockResolvedValue(undefined);

    const installPods = createInstallPodsBuildFunction();
    const globalContext = createGlobalContextMock({});
    const buildStep = installPods.createBuildStepFromFunctionCall(globalContext, {
      callInputs: {},
    });

    await buildStep.executeAsync();

    expect(waitForPrecompiledModulesPreparationAsync).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      'pod',
      ['install'],
      expect.objectContaining({
        cwd: globalContext.defaultWorkingDirectory,
      })
    );
  });

  it('continues with pod install when precompiled dependencies preparation fails', async () => {
    jest.mocked(spawn).mockResolvedValue({} as any);
    jest
      .mocked(waitForPrecompiledModulesPreparationAsync)
      .mockRejectedValue(new Error('precompiled dependencies failed'));

    const installPods = createInstallPodsBuildFunction();
    const globalContext = createGlobalContextMock({});
    const buildStep = installPods.createBuildStepFromFunctionCall(globalContext, {
      callInputs: {},
    });

    await expect(buildStep.executeAsync()).resolves.toBeUndefined();

    expect(waitForPrecompiledModulesPreparationAsync).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      'pod',
      ['install'],
      expect.objectContaining({
        cwd: globalContext.defaultWorkingDirectory,
      })
    );
  });
});
