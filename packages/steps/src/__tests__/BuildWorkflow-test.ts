import { instance, mock, verify, when } from 'ts-mockito';

import { BuildStep } from '../BuildStep.js';
import { BuildWorkflow } from '../BuildWorkflow.js';

import { createGlobalContextMock } from './utils/context.js';

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
});
