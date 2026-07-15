import { Datadog } from '../../datadog';
import { reportWorkflowHookMetricToDatadog } from '../hookMetrics';

describe(reportWorkflowHookMetricToDatadog, () => {
  const distributionSpy = jest.spyOn(Datadog, 'distribution').mockImplementation(() => {});

  beforeEach(() => {
    distributionSpy.mockClear();
  });

  it('emits one eas.workflow.hook distribution tagged by anchor/timing/result', () => {
    reportWorkflowHookMetricToDatadog({
      anchor: 'install_node_modules',
      timing: 'before',
      result: 'success',
    });
    expect(distributionSpy).toHaveBeenCalledTimes(1);
    expect(distributionSpy).toHaveBeenCalledWith('eas.workflow.hook', 1, {
      anchor: 'install_node_modules',
      timing: 'before',
      result: 'success',
    });
  });

  it('adds the anchor_result tag on after events', () => {
    reportWorkflowHookMetricToDatadog({
      anchor: 'submit',
      timing: 'after',
      result: 'failed',
      anchorResult: 'failed',
    });
    expect(distributionSpy).toHaveBeenCalledWith('eas.workflow.hook', 1, {
      anchor: 'submit',
      timing: 'after',
      result: 'failed',
      anchor_result: 'failed',
    });
  });
});
