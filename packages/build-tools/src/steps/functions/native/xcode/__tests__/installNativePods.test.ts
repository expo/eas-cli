import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';

import { createGlobalContextMock } from '../../../../../__tests__/utils/context';
import { createInstallNativePodsBuildFunction } from '../installNativePods';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));

const projectDirectory = '/project';

async function runInstallNativePodsAsync(): Promise<void> {
  const globalCtx = createGlobalContextMock({ projectTargetDirectory: projectDirectory });
  await createInstallNativePodsBuildFunction()
    .createBuildStepFromFunctionCall(globalCtx)
    .executeAsync();
}

afterEach(() => {
  vol.reset();
});

describe(createInstallNativePodsBuildFunction, () => {
  it('runs pod install in the project directory when it has a Podfile', async () => {
    vol.fromJSON({ Podfile: '', 'App.xcodeproj/project.pbxproj': '' }, projectDirectory);

    await runInstallNativePodsAsync();

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      'pod',
      ['install'],
      expect.objectContaining({ cwd: projectDirectory })
    );
  });

  it('does nothing when the project directory has no Podfile', async () => {
    vol.fromJSON({ 'App.xcodeproj/project.pbxproj': '', 'ios/Podfile': '' }, projectDirectory);

    await runInstallNativePodsAsync();

    expect(spawn).not.toHaveBeenCalled();
  });
});
