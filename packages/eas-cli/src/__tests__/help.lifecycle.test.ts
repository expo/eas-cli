import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '../../../..');
const fixture = path.join(__dirname, 'fixtures/simulator-control-lifecycle.cjs');
const actionHelp = [
  ['simulator:control', 'rotate', '--help'],
  ['sim:control', 'screenshot.capture', '-h', '--id', 'session-123'],
  ['simulator:control', '--id', 'session-123', '--help', 'rotate'],
];
const incompleteFlags = [
  ['simulator:control', 'screenshot.capture', '--help', '--output'],
  ['sim:control', 'rotate', '-h', '--id'],
];
let results: { stdout: string; events: unknown[]; error?: string }[];

beforeAll(async () => {
  // Load TypeScript once, outside per-case timeouts, including on coverage runners.
  const { stdout } = await execFileAsync(
    process.execPath,
    [fixture, root, JSON.stringify([...actionHelp, ...incompleteFlags])],
    { timeout: 20_000 }
  );
  results = JSON.parse(stdout.split('LIFECYCLE_RESULT ').at(-1)!);
}, 30_000);

describe('simulator action help through real oclif lookup and hooks', () => {
  it.each(actionHelp.map((argv, index) => ({ argv, index })))(
    'keeps canonical command identity and executes lifecycle hooks: $argv',
    ({ index }) => {
      expect(results[index].error).toBeUndefined();
      expect(results[index].events).toEqual([
        { event: 'prerun', id: 'simulator:control' },
        { event: 'run', id: 'simulator:control' },
        { event: 'postrun', id: 'simulator:control' },
      ]);
    }
  );

  it.each(incompleteFlags.map((argv, index) => ({ argv, index })))(
    'shows ordinary help without starting the command for an incomplete flag: $argv',
    ({ index }) => {
      const { stdout, events, error } = results[index + actionHelp.length];
      expect(error).toBeUndefined();
      expect(stdout).toContain('USAGE');
      expect(events).toEqual([]);
    }
  );
});
