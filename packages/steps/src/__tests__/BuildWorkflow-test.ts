import { instance, mock, verify, when } from 'ts-mockito';

import { BuildStep } from '../BuildStep';
import { BuildWorkflow } from '../BuildWorkflow';
import { BuildRuntimePlatform } from '../BuildRuntimePlatform';

import { createGlobalContextMock } from './utils/context';

describe(BuildWorkflow, () => {
  describe(BuildWorkflow.prototype.executeAsync, () => {
    it('executes all steps passed to the constructor', async () => {
      const mockBuildStep1 = mock<BuildStep>();
      const mockBuildStep2 = mock<BuildStep>();
      const mockBuildStep3 = mock<BuildStep>();
      const mockBuildStep4 = mock<BuildStep>();
      when(mockBuildStep4.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep3.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep2.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep1.shouldExecuteStep()).thenReturn(true);

      const buildSteps: BuildStep[] = [
        instance(mockBuildStep1),
        instance(mockBuildStep2),
        instance(mockBuildStep3),
      ];

      const ctx = createGlobalContextMock();
      const workflow = new BuildWorkflow(ctx, { buildSteps, buildFunctions: {} });
      await workflow.executeAsync();

      verify(mockBuildStep1.executeAsync()).once();
      verify(mockBuildStep2.executeAsync()).once();
      verify(mockBuildStep3.executeAsync()).once();
      verify(mockBuildStep4.executeAsync()).never();
    });

    it('executes steps in correct order', async () => {
      const mockBuildStep1 = mock<BuildStep>();
      const mockBuildStep2 = mock<BuildStep>();
      const mockBuildStep3 = mock<BuildStep>();
      when(mockBuildStep3.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep2.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep1.shouldExecuteStep()).thenReturn(true);

      const buildSteps: BuildStep[] = [
        instance(mockBuildStep1),
        instance(mockBuildStep3),
        instance(mockBuildStep2),
      ];

      const ctx = createGlobalContextMock();
      const workflow = new BuildWorkflow(ctx, { buildSteps, buildFunctions: {} });
      await workflow.executeAsync();

      verify(mockBuildStep1.executeAsync()).calledBefore(mockBuildStep3.executeAsync());
      verify(mockBuildStep3.executeAsync()).calledBefore(mockBuildStep2.executeAsync());
      verify(mockBuildStep2.executeAsync()).once();
    });

    it('executes only steps which should be executed', async () => {
      const mockBuildStep1 = mock<BuildStep>();
      const mockBuildStep2 = mock<BuildStep>();
      const mockBuildStep3 = mock<BuildStep>();
      const mockBuildStep4 = mock<BuildStep>();
      when(mockBuildStep4.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep3.shouldExecuteStep()).thenReturn(false);
      when(mockBuildStep2.shouldExecuteStep()).thenReturn(false);
      when(mockBuildStep1.shouldExecuteStep()).thenReturn(true);

      const buildSteps: BuildStep[] = [
        instance(mockBuildStep1),
        instance(mockBuildStep2),
        instance(mockBuildStep3),
        instance(mockBuildStep4),
      ];

      const ctx = createGlobalContextMock();
      const workflow = new BuildWorkflow(ctx, { buildSteps, buildFunctions: {} });
      await workflow.executeAsync();

      verify(mockBuildStep1.executeAsync()).once();
      verify(mockBuildStep2.executeAsync()).never();
      verify(mockBuildStep3.executeAsync()).never();
      verify(mockBuildStep4.executeAsync()).once();
    });

    it('throws an error if any step fails', async () => {
      const mockBuildStep1 = mock<BuildStep>();
      const mockBuildStep2 = mock<BuildStep>();
      const mockBuildStep3 = mock<BuildStep>();
      when(mockBuildStep3.shouldExecuteStep()).thenReturn(false);
      when(mockBuildStep2.shouldExecuteStep()).thenReturn(false);
      when(mockBuildStep1.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep1.executeAsync()).thenReject(new Error('Step 1 failed'));

      const buildSteps: BuildStep[] = [
        instance(mockBuildStep1),
        instance(mockBuildStep2),
        instance(mockBuildStep3),
      ];

      const ctx = createGlobalContextMock();
      const workflow = new BuildWorkflow(ctx, { buildSteps, buildFunctions: {} });
      await expect(workflow.executeAsync()).rejects.toThrowError('Step 1 failed');

      verify(mockBuildStep1.executeAsync()).once();
      verify(mockBuildStep2.executeAsync()).never();
      verify(mockBuildStep3.executeAsync()).never();
    });

    it('even if previous step fails if next ones should be executed they are executed', async () => {
      const mockBuildStep1 = mock<BuildStep>();
      const mockBuildStep2 = mock<BuildStep>();
      const mockBuildStep3 = mock<BuildStep>();
      when(mockBuildStep3.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep2.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep1.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep1.executeAsync()).thenReject(new Error('Step 1 failed'));

      const buildSteps: BuildStep[] = [
        instance(mockBuildStep1),
        instance(mockBuildStep2),
        instance(mockBuildStep3),
      ];

      const ctx = createGlobalContextMock();
      const workflow = new BuildWorkflow(ctx, { buildSteps, buildFunctions: {} });
      await expect(workflow.executeAsync()).rejects.toThrowError('Step 1 failed');

      verify(mockBuildStep1.executeAsync()).once();
      verify(mockBuildStep2.executeAsync()).once();
      verify(mockBuildStep3.executeAsync()).once();
    });

    it('throws always the first error', async () => {
      const mockBuildStep1 = mock<BuildStep>();
      const mockBuildStep2 = mock<BuildStep>();
      const mockBuildStep3 = mock<BuildStep>();
      when(mockBuildStep3.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep2.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep1.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep1.executeAsync()).thenReject(new Error('Step 1 failed'));
      when(mockBuildStep2.executeAsync()).thenReject(new Error('Step 2 failed'));
      when(mockBuildStep3.executeAsync()).thenReject(new Error('Step 3 failed'));

      const buildSteps: BuildStep[] = [
        instance(mockBuildStep1),
        instance(mockBuildStep2),
        instance(mockBuildStep3),
      ];

      const ctx = createGlobalContextMock();
      const workflow = new BuildWorkflow(ctx, { buildSteps, buildFunctions: {} });
      await expect(workflow.executeAsync()).rejects.toThrowError('Step 1 failed');

      verify(mockBuildStep1.executeAsync()).once();
      verify(mockBuildStep2.executeAsync()).once();
      verify(mockBuildStep3.executeAsync()).once();
    });
  });

  describe('step metrics collection', () => {
    it('collects metrics for steps with __metricsId', async () => {
      const mockBuildStep = mock<BuildStep>();
      when(mockBuildStep.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep.executeAsync()).thenResolve();
      when(mockBuildStep.__metricsId).thenReturn('test-step-metrics');

      const buildSteps: BuildStep[] = [instance(mockBuildStep)];

      const ctx = createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX });
      const workflow = new BuildWorkflow(ctx, { buildSteps, buildFunctions: {} });
      await workflow.executeAsync();

      expect(ctx.stepMetrics).toHaveLength(1);
      expect(ctx.stepMetrics[0]).toMatchObject({
        metricsId: 'test-step-metrics',
        result: 'success',
        platform: 'linux',
      });
      expect(ctx.stepMetrics[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('does not collect metrics for steps without __metricsId', async () => {
      const mockBuildStep = mock<BuildStep>();
      when(mockBuildStep.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep.executeAsync()).thenResolve();
      when(mockBuildStep.__metricsId).thenReturn(undefined);

      const buildSteps: BuildStep[] = [instance(mockBuildStep)];

      const ctx = createGlobalContextMock();
      const workflow = new BuildWorkflow(ctx, { buildSteps, buildFunctions: {} });
      await workflow.executeAsync();

      expect(ctx.stepMetrics).toHaveLength(0);
    });

    it('collects failed result when step throws', async () => {
      const mockBuildStep = mock<BuildStep>();
      when(mockBuildStep.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep.executeAsync()).thenReject(new Error('Step failed'));
      when(mockBuildStep.__metricsId).thenReturn('failing-step-metrics');

      const buildSteps: BuildStep[] = [instance(mockBuildStep)];

      const ctx = createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.DARWIN });
      const workflow = new BuildWorkflow(ctx, { buildSteps, buildFunctions: {} });
      await expect(workflow.executeAsync()).rejects.toThrowError('Step failed');

      expect(ctx.stepMetrics).toHaveLength(1);
      expect(ctx.stepMetrics[0]).toMatchObject({
        metricsId: 'failing-step-metrics',
        result: 'failed',
        platform: 'darwin',
      });
      expect(ctx.stepMetrics[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('does not collect metrics when step is skipped', async () => {
      const mockBuildStep = mock<BuildStep>();
      when(mockBuildStep.shouldExecuteStep()).thenReturn(false);
      when(mockBuildStep.__metricsId).thenReturn('skipped-step-metrics');

      const buildSteps: BuildStep[] = [instance(mockBuildStep)];

      const ctx = createGlobalContextMock();
      const workflow = new BuildWorkflow(ctx, { buildSteps, buildFunctions: {} });
      await workflow.executeAsync();

      // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
      verify(mockBuildStep.skip()).once();
      expect(ctx.stepMetrics).toHaveLength(0);
    });

    it('collects metrics with darwin platform when runtimePlatform is darwin', async () => {
      const mockBuildStep = mock<BuildStep>();
      when(mockBuildStep.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep.executeAsync()).thenResolve();
      when(mockBuildStep.__metricsId).thenReturn('darwin-step');

      const buildSteps: BuildStep[] = [instance(mockBuildStep)];

      const ctx = createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.DARWIN });
      const workflow = new BuildWorkflow(ctx, { buildSteps, buildFunctions: {} });
      await workflow.executeAsync();

      expect(ctx.stepMetrics).toHaveLength(1);
      expect(ctx.stepMetrics[0].platform).toBe('darwin');
    });

    it('collects metrics for multiple steps', async () => {
      const mockBuildStep1 = mock<BuildStep>();
      const mockBuildStep2 = mock<BuildStep>();
      const mockBuildStep3 = mock<BuildStep>();

      when(mockBuildStep1.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep1.executeAsync()).thenResolve();
      when(mockBuildStep1.__metricsId).thenReturn('step-1');

      when(mockBuildStep2.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep2.executeAsync()).thenResolve();
      when(mockBuildStep2.__metricsId).thenReturn(undefined); // No metricsId

      when(mockBuildStep3.shouldExecuteStep()).thenReturn(true);
      when(mockBuildStep3.executeAsync()).thenResolve();
      when(mockBuildStep3.__metricsId).thenReturn('step-3');

      const buildSteps: BuildStep[] = [
        instance(mockBuildStep1),
        instance(mockBuildStep2),
        instance(mockBuildStep3),
      ];

      const ctx = createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX });
      const workflow = new BuildWorkflow(ctx, { buildSteps, buildFunctions: {} });
      await workflow.executeAsync();

      expect(ctx.stepMetrics).toHaveLength(2);
      expect(ctx.stepMetrics[0].metricsId).toBe('step-1');
      expect(ctx.stepMetrics[1].metricsId).toBe('step-3');
    });
  });
});
