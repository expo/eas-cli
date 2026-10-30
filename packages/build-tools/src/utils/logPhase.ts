import { BuildPhase, BuildPhaseResult, LogMarker } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { BuildStep } from '@expo/steps';

export function startLogPhase(logger: bunyan, name: string) {
  const phaseLogger = logger.child({
    phase: BuildPhase.CUSTOM,
    buildStepId: BuildStep.getNewId(),
    buildStepDisplayName: name,
  });
  phaseLogger.info({ marker: LogMarker.START_PHASE }, `Start phase: ${name}`);
  let ended = false;
  return {
    logger: phaseLogger,
    end(result: BuildPhaseResult): void {
      if (ended) {
        return;
      }
      ended = true;
      phaseLogger.info({ marker: LogMarker.END_PHASE, result }, `End phase: ${name}`);
    },
  };
}

export async function withLogPhaseAsync<T>(
  logger: bunyan,
  name: string,
  fn: (logger: bunyan) => Promise<T>
): Promise<T> {
  const phase = startLogPhase(logger, name);
  try {
    const result = await fn(phase.logger);
    phase.end(BuildPhaseResult.SUCCESS);
    return result;
  } catch (error) {
    phase.end(BuildPhaseResult.FAIL);
    throw error;
  }
}
