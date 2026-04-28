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

  it('collects Android emulator logs before uploading Maestro results', () => {
    const ctx = {
      job: {
        platform: Platform.ANDROID,
      },
    } as unknown as Parameters<typeof createEasMaestroTestFunctionGroup>[0];
    const globalCtx = createGlobalContextMock();

    const steps = createEasMaestroTestFunctionGroup(ctx).createBuildStepsFromFunctionGroupCall(
      globalCtx,
      {
        callInputs: {
          flow_path: 'maestro/home.yml\nmaestro/login.yml',
        },
      }
    );

    const stepDisplayNames = steps.map(step => step.displayName);
    expect(stepDisplayNames).toEqual([
      'Install Maestro',
      'Start Android Emulator',
      'Install app to Emulator',
      'maestro test maestro/home.yml',
      'maestro test maestro/login.yml',
      'Collect Android emulator logs',
      'Upload Maestro test results',
    ]);
    expect(steps[5].ifCondition).toBe('${ always() }');
    expect(steps[6].ifCondition).toBe('${ always() }');
  });
});
