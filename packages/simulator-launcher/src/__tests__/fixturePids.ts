// Test fixtures use these PIDs for fake child processes. Fail fast instead of letting a test
// reach the real process.kill with one of them, where it could signal an unrelated process.
const FIXTURE_PIDS = new Set([10, 11, 12, 20, 30, 40, 41]);
const isFixturePid = (pid: number): boolean =>
  FIXTURE_PIDS.has(Math.abs(pid)) || (Math.abs(pid) >= 90000 && Math.abs(pid) < 90100);

const realKill = process.kill.bind(process);
process.kill = ((pid: number, signal?: string | number) => {
  if (isFixturePid(pid)) {
    throw new Error(`A test tried to signal fixture PID ${pid} through the real process.kill.`);
  }
  return realKill(pid, signal);
}) as typeof process.kill;
