import { validate as isUuid } from 'uuid';

type SimulatorLifecycleEvent =
  | { event: 'start' }
  | { event: 'allocated'; id: string }
  | { event: 'cleanup'; id: string; outcome: 'stopped' | 'unknown' };

// Only the invoking process opts in. Project dotenv files load during the command.
const requestId = process.env.EAS_SIMULATOR_LIFECYCLE;

export function reportSimulatorLifecycle(event: SimulatorLifecycleEvent): void {
  if (requestId && isUuid(requestId)) {
    // A spinner may have left an unterminated frame on stderr.
    process.stderr.write(`\nEAS_SIMULATOR_LIFECYCLE ${requestId} ${JSON.stringify(event)}\n`);
  }
}
