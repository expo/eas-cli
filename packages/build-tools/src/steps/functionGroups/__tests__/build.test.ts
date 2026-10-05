import { BuildJob, Platform } from '@expo/eas-build-job';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { CustomBuildContext } from '../../../customBuildContext';
import { createEasBuildBuildFunctionGroup } from '../build';

function createMockBuildToolsContext(
  overrides: Partial<{
    platform: Platform;
    simulator: boolean;
    buildCredentials: Record<string, unknown>;
  }> = {}
): CustomBuildContext<BuildJob> {
  return {
    job: {
      platform: overrides.platform ?? Platform.ANDROID,
      simulator: overrides.simulator ?? false,
      secrets: overrides.buildCredentials
        ? { buildCredentials: overrides.buildCredentials }
        : undefined,
    },
  } as unknown as CustomBuildContext<BuildJob>;
}

describe(createEasBuildBuildFunctionGroup, () => {
  describe('working_directory input', () => {
    it('does not set working directory on steps when not provided (Android)', () => {
      const buildToolsContext = createMockBuildToolsContext({ platform: Platform.ANDROID });
      const functionGroup = createEasBuildBuildFunctionGroup(buildToolsContext);
      const globalCtx = createGlobalContextMock({ logger: createMockLogger() });

      const steps = functionGroup.createBuildStepsFromFunctionGroupCall(globalCtx);

      for (const step of steps) {
        // Without working_directory, only installPods would have a relative dir (iOS only).
        // On Android, no step should have a relative working directory.
        expect(step.ctx.relativeWorkingDirectory).toBeUndefined();
      }
    });

    it('sets working directory on all steps except checkout (Android)', () => {
      const buildToolsContext = createMockBuildToolsContext({ platform: Platform.ANDROID });
      const functionGroup = createEasBuildBuildFunctionGroup(buildToolsContext);
      const globalCtx = createGlobalContextMock({ logger: createMockLogger() });

      const steps = functionGroup.createBuildStepsFromFunctionGroupCall(globalCtx, {
        callInputs: { working_directory: './my-app' },
      });

      const checkoutStep = steps.find(s => s.displayName === 'Checkout');
      expect(checkoutStep).toBeDefined();
      expect(checkoutStep!.ctx.relativeWorkingDirectory).toBeUndefined();

      const nonCheckoutSteps = steps.filter(s => s.displayName !== 'Checkout');
      expect(nonCheckoutSteps.length).toBeGreaterThan(0);
      for (const step of nonCheckoutSteps) {
        expect(step.ctx.relativeWorkingDirectory).toBe('./my-app');
      }
    });

    it('sets working directory on all steps except checkout (iOS simulator)', () => {
      const buildToolsContext = createMockBuildToolsContext({
        platform: Platform.IOS,
        simulator: true,
      });
      const functionGroup = createEasBuildBuildFunctionGroup(buildToolsContext);
      const globalCtx = createGlobalContextMock({ logger: createMockLogger() });

      const steps = functionGroup.createBuildStepsFromFunctionGroupCall(globalCtx, {
        callInputs: { working_directory: './my-app' },
      });

      const checkoutStep = steps.find(s => s.displayName === 'Checkout');
      expect(checkoutStep).toBeDefined();
      expect(checkoutStep!.ctx.relativeWorkingDirectory).toBeUndefined();

      const nonCheckoutSteps = steps.filter(s => s.displayName !== 'Checkout');
      expect(nonCheckoutSteps.length).toBeGreaterThan(0);
      for (const step of nonCheckoutSteps) {
        expect(step.ctx.relativeWorkingDirectory).toBeDefined();
        expect(step.ctx.relativeWorkingDirectory).toContain('my-app');
      }
    });

    it('sets working directory on all steps except checkout (iOS with credentials)', () => {
      const buildToolsContext = createMockBuildToolsContext({
        platform: Platform.IOS,
        buildCredentials: { test: {} },
      });
      const functionGroup = createEasBuildBuildFunctionGroup(buildToolsContext);
      const globalCtx = createGlobalContextMock({ logger: createMockLogger() });

      const steps = functionGroup.createBuildStepsFromFunctionGroupCall(globalCtx, {
        callInputs: { working_directory: './my-app' },
      });

      const checkoutStep = steps.find(s => s.displayName === 'Checkout');
      expect(checkoutStep).toBeDefined();
      expect(checkoutStep!.ctx.relativeWorkingDirectory).toBeUndefined();

      const nonCheckoutSteps = steps.filter(s => s.displayName !== 'Checkout');
      expect(nonCheckoutSteps.length).toBeGreaterThan(0);
      for (const step of nonCheckoutSteps) {
        expect(step.ctx.relativeWorkingDirectory).toBeDefined();
        expect(step.ctx.relativeWorkingDirectory).toContain('my-app');
      }
    });

    it('wires configure_ios_credentials target_names into configure_ios_version', () => {
      const buildToolsContext = createMockBuildToolsContext({
        platform: Platform.IOS,
        buildCredentials: { test: {} },
      });
      const functionGroup = createEasBuildBuildFunctionGroup(buildToolsContext);
      const globalCtx = createGlobalContextMock({ logger: createMockLogger() });

      const steps = functionGroup.createBuildStepsFromFunctionGroupCall(globalCtx, {
        callInputs: { working_directory: './my-app' },
      });

      const configureIosVersionStep = steps.find(s => s.displayName === 'Configure iOS version');
      const targetNamesInput = configureIosVersionStep?.inputs?.find(
        input => input.id === 'target_names'
      );

      expect(configureIosVersionStep).toBeDefined();
      expect(targetNamesInput?.rawValue).toBe(
        '${{ steps.configure_ios_credentials.outputs.target_names }}'
      );
    });

    it('composes working directory with installPods step-level ./ios dir (iOS)', () => {
      const buildToolsContext = createMockBuildToolsContext({
        platform: Platform.IOS,
        simulator: true,
      });
      const functionGroup = createEasBuildBuildFunctionGroup(buildToolsContext);
      const globalCtx = createGlobalContextMock({ logger: createMockLogger() });

      const steps = functionGroup.createBuildStepsFromFunctionGroupCall(globalCtx, {
        callInputs: { working_directory: './my-app' },
      });

      const installPodsStep = steps.find(s => s.displayName === 'Install Pods');
      expect(installPodsStep).toBeDefined();
      expect(installPodsStep!.ctx.relativeWorkingDirectory).toBe('my-app/ios');
    });

    it('uses ./ios for installPods when no working_directory provided (iOS)', () => {
      const buildToolsContext = createMockBuildToolsContext({
        platform: Platform.IOS,
        simulator: true,
      });
      const functionGroup = createEasBuildBuildFunctionGroup(buildToolsContext);
      const globalCtx = createGlobalContextMock({ logger: createMockLogger() });

      const steps = functionGroup.createBuildStepsFromFunctionGroupCall(globalCtx);

      const installPodsStep = steps.find(s => s.displayName === 'Install Pods');
      expect(installPodsStep).toBeDefined();
      expect(installPodsStep!.ctx.relativeWorkingDirectory).toBe('./ios');
    });

    it('restores and saves caches around an iOS simulator build', () => {
      const buildToolsContext = createMockBuildToolsContext({
        platform: Platform.IOS,
        simulator: true,
      });
      const functionGroup = createEasBuildBuildFunctionGroup(buildToolsContext);
      const globalCtx = createGlobalContextMock({ logger: createMockLogger() });

      const steps = functionGroup.createBuildStepsFromFunctionGroupCall(globalCtx);
      const stepNames = steps.map(step => step.displayName);
      const restoreCacheIndex = stepNames.indexOf('Restore Cache');
      const installPodsIndex = stepNames.indexOf('Install Pods');
      const saveCacheIndex = stepNames.indexOf('Save Cache');

      expect(restoreCacheIndex).toBeGreaterThan(-1);
      expect(restoreCacheIndex).toBeLessThan(installPodsIndex);
      expect(saveCacheIndex).toBeGreaterThan(installPodsIndex);

      const restoreCacheStep = steps[restoreCacheIndex];
      expect(restoreCacheStep.inputs?.find(input => input.id === 'simulator')?.rawValue).toBe(true);
    });

    it('sets working directory on all steps except checkout (Android with credentials)', () => {
      const buildToolsContext = createMockBuildToolsContext({
        platform: Platform.ANDROID,
        buildCredentials: { test: {} },
      });
      const functionGroup = createEasBuildBuildFunctionGroup(buildToolsContext);
      const globalCtx = createGlobalContextMock({ logger: createMockLogger() });

      const steps = functionGroup.createBuildStepsFromFunctionGroupCall(globalCtx, {
        callInputs: { working_directory: './my-app' },
      });

      const checkoutStep = steps.find(s => s.displayName === 'Checkout');
      expect(checkoutStep).toBeDefined();
      expect(checkoutStep!.ctx.relativeWorkingDirectory).toBeUndefined();

      const nonCheckoutSteps = steps.filter(s => s.displayName !== 'Checkout');
      expect(nonCheckoutSteps.length).toBeGreaterThan(0);
      for (const step of nonCheckoutSteps) {
        expect(step.ctx.relativeWorkingDirectory).toBe('./my-app');
      }
    });
  });

  it('throws for generic jobs (no platform)', () => {
    const buildToolsContext = {
      job: { platform: undefined },
    } as unknown as CustomBuildContext<BuildJob>;
    const functionGroup = createEasBuildBuildFunctionGroup(buildToolsContext);
    const globalCtx = createGlobalContextMock({ logger: createMockLogger() });

    expect(() => functionGroup.createBuildStepsFromFunctionGroupCall(globalCtx)).toThrow(
      'Build function group is not supported in generic jobs.'
    );
  });

  describe('embedded bundle upload', () => {
    function getStepNames(
      options: Parameters<typeof createMockBuildToolsContext>[0],
      { sdkVersion, env = {} }: { sdkVersion?: string; env?: Record<string, string> }
    ): string[] {
      const functionGroup = createEasBuildBuildFunctionGroup(createMockBuildToolsContext(options));
      const globalCtx = createGlobalContextMock({
        logger: createMockLogger(),
        staticContextContent: { metadata: sdkVersion ? { sdkVersion } : null },
      });
      globalCtx.updateEnv(env);
      return functionGroup
        .createBuildStepsFromFunctionGroupCall(globalCtx)
        .map(step => step.displayName);
    }

    it.each([
      ['Android', { platform: Platform.ANDROID }],
      ['Android with credentials', { platform: Platform.ANDROID, buildCredentials: { test: {} } }],
      ['iOS with credentials', { platform: Platform.IOS, buildCredentials: { test: {} } }],
    ])('uploads the embedded bundle after the build artifacts on SDK 58 (%s)', (_, options) => {
      const stepNames = getStepNames(options, { sdkVersion: '58.0.0' });

      expect(stepNames.indexOf('Upload embedded bundle')).toBe(
        stepNames.indexOf('Find and upload build artifacts') + 1
      );
    });

    it.each([
      ['Android', { platform: Platform.ANDROID }],
      ['Android with credentials', { platform: Platform.ANDROID, buildCredentials: { test: {} } }],
      ['iOS with credentials', { platform: Platform.IOS, buildCredentials: { test: {} } }],
    ])('passes ignore_error to the embedded bundle step (%s)', (_, options) => {
      const functionGroup = createEasBuildBuildFunctionGroup(createMockBuildToolsContext(options));
      const globalCtx = createGlobalContextMock({
        logger: createMockLogger(),
        staticContextContent: { metadata: { sdkVersion: '58.0.0' } },
      });

      const uploadStep = functionGroup
        .createBuildStepsFromFunctionGroupCall(globalCtx)
        .find(step => step.displayName === 'Upload embedded bundle');

      expect(uploadStep).toBeDefined();
      expect(uploadStep!.inputs?.find(input => input.id === 'ignore_error')?.rawValue).toBe(true);
    });

    it('does not upload the embedded bundle on SDK 57 without the opt-in', () => {
      expect(getStepNames({}, { sdkVersion: '57.0.0' })).not.toContain('Upload embedded bundle');
    });

    it('uploads the embedded bundle on SDK 57 with the opt-in', () => {
      expect(
        getStepNames(
          {},
          { sdkVersion: '57.0.0', env: { EAS_UPDATE_EXPERIMENTAL_UPLOAD_EMBEDDED_BUNDLE: '1' } }
        )
      ).toContain('Upload embedded bundle');
    });

    it('does not upload the embedded bundle for iOS simulator builds', () => {
      expect(
        getStepNames({ platform: Platform.IOS, simulator: true }, { sdkVersion: '58.0.0' })
      ).not.toContain('Upload embedded bundle');
    });
  });
});
