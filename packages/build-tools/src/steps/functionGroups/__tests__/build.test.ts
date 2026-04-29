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
});
