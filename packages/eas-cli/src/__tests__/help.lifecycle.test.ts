import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '../../../..');
const fixture = path.join(__dirname, 'fixtures/simulator-control-lifecycle.cjs');

async function runHelpAsync(argv: string[]): Promise<{ stdout: string; events: unknown[] }> {
  const { stdout } = await execFileAsync(process.execPath, [fixture, root, JSON.stringify(argv)], {
    timeout: 10_000,
  });
  const result = stdout.split('LIFECYCLE_RESULT ').at(-1)!;
  return { stdout, events: JSON.parse(result) };
}

describe('simulator action help through real oclif lookup and hooks', () => {
  it.each([
    ['simulator:control', 'rotate', '--help'],
    ['sim:control', 'screenshot.capture', '-h', '--id', 'session-123'],
    ['simulator:control', '--id', 'session-123', '--help', 'rotate'],
  ])('keeps canonical command identity and executes lifecycle hooks: %j', async (...argv) => {
    expect((await runHelpAsync(argv)).events).toEqual([
      { event: 'prerun', id: 'simulator:control' },
      { event: 'run', id: 'simulator:control' },
      { event: 'postrun', id: 'simulator:control' },
    ]);
  });

  it.each([
    ['simulator:control', 'screenshot.capture', '--help', '--output'],
    ['sim:control', 'rotate', '-h', '--id'],
  ])(
    'shows ordinary help without starting the command for an incomplete flag: %j',
    async (...argv) => {
      const { stdout, events } = await runHelpAsync(argv);
      expect(stdout).toContain('USAGE');
      expect(events).toEqual([]);
    }
  );
});
