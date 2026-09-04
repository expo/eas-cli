import { BuildPhase, BuildPhaseResult, LogMarker } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { BuildStep } from '@expo/steps';

export async function withLogPhaseAsync<T>(
  logger: bunyan,
  name: string,
  fn: (logger: bunyan) => Promise<T>
): Promise<T> {
  const phaseLogger = logger.child({
    phase: BuildPhase.CUSTOM,
    buildStepId: BuildStep.getNewId(),
    buildStepDisplayName: name,
  });
  phaseLogger.info({ marker: LogMarker.START_PHASE }, `Start phase: ${name}`);
  try {
    const result = await fn(phaseLogger);
    phaseLogger.info(
      { marker: LogMarker.END_PHASE, result: BuildPhaseResult.SUCCESS },
      `End phase: ${name}`
    );
    return result;
  } catch (error) {
    phaseLogger.info(
      { marker: LogMarker.END_PHASE, result: BuildPhaseResult.FAIL },
      `End phase: ${name}`
    );
    throw error;
  }
}
