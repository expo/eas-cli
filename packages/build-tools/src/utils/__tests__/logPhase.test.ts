import { BuildPhase, BuildPhaseResult, LogMarker } from '@expo/eas-build-job';

import { startLogPhase, withLogPhaseAsync } from '../logPhase';

describe(withLogPhaseAsync.name, () => {
  const phaseLogger = { info: jest.fn() };
  const logger = { child: jest.fn(() => phaseLogger) };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the callback result and ends the phase successfully', async () => {
    const result = await withLogPhaseAsync(logger as any, 'Phase name', async callbackLogger => {
      expect(callbackLogger).toBe(phaseLogger);
      return 'result';
    });

    expect(result).toBe('result');
    expect(logger.child).toHaveBeenCalledWith({
      phase: BuildPhase.CUSTOM,
      buildStepId: expect.stringMatching(/^step-\d{3,}$/),
      buildStepDisplayName: 'Phase name',
    });
    expect(phaseLogger.info).toHaveBeenNthCalledWith(
      1,
      { marker: LogMarker.START_PHASE },
      'Start phase: Phase name'
    );
    expect(phaseLogger.info).toHaveBeenNthCalledWith(
      2,
      { marker: LogMarker.END_PHASE, result: BuildPhaseResult.SUCCESS },
      'End phase: Phase name'
    );
  });

  it('ends the phase with failure and rethrows the error', async () => {
    const error = new Error('failed');

    await expect(
      withLogPhaseAsync(logger as any, 'Phase name', async () => {
        throw error;
      })
    ).rejects.toBe(error);

    expect(phaseLogger.info).toHaveBeenLastCalledWith(
      { marker: LogMarker.END_PHASE, result: BuildPhaseResult.FAIL },
      'End phase: Phase name'
    );
  });
});

it('keeps concurrent phases separate and ends each only once', () => {
  const first = { info: jest.fn() };
  const second = { info: jest.fn() };
  const logger = { child: jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
  const tools = startLogPhase(logger as any, 'Argent session');
  const preview = startLogPhase(logger as any, 'Simulator preview');
  expect(logger.child.mock.calls[0][0].buildStepId).not.toBe(
    logger.child.mock.calls[1][0].buildStepId
  );
  tools.logger.info('tool output');
  preview.logger.info('preview output');
  preview.end(BuildPhaseResult.FAIL);
  preview.end(BuildPhaseResult.SUCCESS);
  expect(
    second.info.mock.calls.filter(([fields]) => fields.marker === LogMarker.END_PHASE)
  ).toHaveLength(1);
  expect(first.info).not.toHaveBeenCalledWith(
    expect.objectContaining({ marker: LogMarker.END_PHASE }),
    expect.anything()
  );
  tools.end(BuildPhaseResult.SUCCESS);
  expect(first.info).toHaveBeenLastCalledWith(
    { marker: LogMarker.END_PHASE, result: BuildPhaseResult.SUCCESS },
    'End phase: Argent session'
  );
});
