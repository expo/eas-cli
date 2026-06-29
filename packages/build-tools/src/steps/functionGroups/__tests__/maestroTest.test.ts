import { BuildJob, Platform } from '@expo/eas-build-job';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { CustomBuildContext } from '../../../customBuildContext';
import { createEasMaestroTestFunctionGroup } from '../maestroTest';

function createMockBuildToolsContext(platform: Platform): CustomBuildContext<BuildJob> {
  return {
    job: { platform },
  } as unknown as CustomBuildContext<BuildJob>;
}

function buildSteps(platform: Platform): { id: string; displayName: string; command?: string }[] {
  const buildToolsContext = createMockBuildToolsContext(platform);
  const functionGroup = createEasMaestroTestFunctionGroup(buildToolsContext);
  const globalCtx = createGlobalContextMock({ logger: createMockLogger() });
  return functionGroup.createBuildStepsFromFunctionGroupCall(globalCtx, {
    callInputs: { flow_path: 'flow.yaml' },
  });
}

describe(createEasMaestroTestFunctionGroup, () => {
  it('targets the udid output by start_ios_simulator on iOS', () => {
    const steps = buildSteps(Platform.IOS);
    const startStep = steps.find(s => s.displayName === 'Start iOS Simulator');
    const maestroStep = steps.find(s => s.command?.includes('maestro test'));

    expect(startStep).toBeDefined();
    expect(maestroStep?.command).toContain(`steps.${startStep!.id}.device_udid`);
    expect(maestroStep?.command).toContain('${DEVICE_UDID:+--udid="$DEVICE_UDID"');
  });

  it('does not target a udid on Android', () => {
    const maestroStep = buildSteps(Platform.ANDROID).find(s => s.command?.includes('maestro test'));
    expect(maestroStep?.command).toBe('maestro test flow.yaml');
  });
});
