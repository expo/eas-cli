import { createGlobalContextMock } from '../../../../../__tests__/utils/context';
import { writeBuildNumberAsync } from '../../../../utils/ios/xcodeProject/buildNumber';
import { createSetNativeXcodeBuildNumberBuildFunction } from '../setNativeXcodeBuildNumber';

jest.mock('../../../../utils/ios/xcodeProject/buildNumber');

const TARGETS = [
  { id: 'APP', name: 'NativeApp', bundleIdentifier: 'dev.expo.nativeapp' },
  { id: 'WIDGET', name: 'Widget', bundleIdentifier: 'dev.expo.nativeapp.widget' },
];

describe(createSetNativeXcodeBuildNumberBuildFunction, () => {
  it('writes the build number of its input into every target and every Info.plist file it is given', async () => {
    const step = createSetNativeXcodeBuildNumberBuildFunction().createBuildStepFromFunctionCall(
      createGlobalContextMock(),
      {
        callInputs: {
          xcodeproj_path: '/project/NativeApp.xcodeproj',
          build_configuration: 'Release',
          targets: TARGETS,
          editable_info_plist_paths: ['/project/Widget/Info.plist'],
          build_number: '43',
        },
      }
    );

    await step.executeAsync();

    expect(writeBuildNumberAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        xcodeprojPath: '/project/NativeApp.xcodeproj',
        buildConfiguration: 'Release',
        targets: TARGETS,
        editableInfoPlistPaths: ['/project/Widget/Info.plist'],
        buildNumber: '43',
      })
    );
    expect(step.ctx.logger.info).toHaveBeenCalledWith(
      'Set the build number to 43 for "NativeApp", "Widget".'
    );
  });
});
