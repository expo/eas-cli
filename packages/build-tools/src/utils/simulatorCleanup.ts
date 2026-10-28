// Built-in Simulator operations wait for worker cleanup while ordinary setup can overlap it.
// A worker handles one job; local builds have no pending warm-session cleanup.
let pendingCleanup: Promise<void> | undefined;

export function setSimulatorCleanupPromise(cleanup: Promise<void>): void {
  pendingCleanup = cleanup;
}

export async function waitForSimulatorCleanupAsync(): Promise<void> {
  await pendingCleanup;
}
