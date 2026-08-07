import { Platform } from '@expo/eas-build-job';

import { createGlobalContextMock } from '../../__tests__/utils/context';
import { getEasFunctionGroups } from '../easFunctionGroups';
import { createEasMaestroTestFunctionGroup } from '../functionGroups/maestroTest';

describe(getEasFunctionGroups, () => {
  it('includes eas/maestro_test for non-build jobs', () => {
    const ctx = {
      hasBuildJob: () => false,
      job: {},
    } as unknown as Parameters<typeof getEasFunctionGroups>[0];

    const functionGroupIds = getEasFunctionGroups(ctx).map(functionGroup =>
      functionGroup.getFullId()
    );
    expect(functionGroupIds).toEqual(['eas/maestro_test']);
  });

  it('includes eas/build for build jobs', () => {
    const ctx = {
      hasBuildJob: () => true,
      job: {},
    } as unknown as Parameters<typeof getEasFunctionGroups>[0];

    const functionGroupIds = getEasFunctionGroups(ctx).map(functionGroup =>
      functionGroup.getFullId()
    );
    expect(functionGroupIds).toEqual(expect.arrayContaining(['eas/build', 'eas/maestro_test']));
  });

  it('uploads Android emulator logs as a stable separate artifact', () => {
    const ctx = {
      job: {
        platform: Platform.ANDROID,
      },
    } as unknown as Parameters<typeof createEasMaestroTestFunctionGroup>[0];

    const steps = createEasMaestroTestFunctionGroup(ctx).createBuildStepsFromFunctionGroupCall(
      createGlobalContextMock(),
      {
        callInputs: {
          flow_path: 'maestro/home.yml',
        },
      }
    );

    expect(steps.some(step => step.id === 'start_android_emulator')).toBe(true);
    const uploadStep = steps.find(step => step.displayName === 'Upload Android emulator logs');
    expect(uploadStep).toBeDefined();
    expect(uploadStep?.ifCondition).toBe('${ always() }');
    expect(
      Object.fromEntries(uploadStep?.inputs?.map(input => [input.id, input.rawValue]) ?? [])
    ).toEqual(
      expect.objectContaining({
        copy_before_upload: true,
        ignore_error: true,
        name: 'Android emulator logs',
        path: '${{ steps.start_android_emulator.outputs.logcat_directory }}',
        type: 'other',
      })
    );
  });
});
