import { Datadog } from '../../datadog';
import { reportWorkflowHookMetricToDatadog } from '../hookMetrics';

describe(reportWorkflowHookMetricToDatadog, () => {
  const distributionSpy = jest.spyOn(Datadog, 'distribution').mockImplementation(() => {});

  beforeEach(() => {
    distributionSpy.mockClear();
  });

  it('emits one eas.workflow.hook distribution tagged by anchor/timing/world/step_kind/result', () => {
    reportWorkflowHookMetricToDatadog(
      { anchor: 'install_node_modules', timing: 'before', kind: 'run', result: 'success' },
      { world: 'steps' }
    );
    expect(distributionSpy).toHaveBeenCalledTimes(1);
    expect(distributionSpy).toHaveBeenCalledWith('eas.workflow.hook', 1, {
      anchor: 'install_node_modules',
      timing: 'before',
      world: 'steps',
      step_kind: 'run',
      result: 'success',
    });
  });

  it('adds the anchor_result tag on after events', () => {
    reportWorkflowHookMetricToDatadog(
      { anchor: 'submit', timing: 'after', kind: 'uses', result: 'failed', anchorResult: 'failed' },
      { world: 'native' }
    );
    expect(distributionSpy).toHaveBeenCalledWith('eas.workflow.hook', 1, {
      anchor: 'submit',
      timing: 'after',
      world: 'native',
      step_kind: 'uses',
      result: 'failed',
      anchor_result: 'failed',
    });
  });
});
