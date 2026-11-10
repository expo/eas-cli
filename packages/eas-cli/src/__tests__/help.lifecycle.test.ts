import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '../../../..');
const fixture = path.join(__dirname, 'fixtures/simulator-control-lifecycle.cjs');
const modes = ['discovery', 'manifest'];
const actionHelp = [
  ['simulator:control', 'rotate', '--help'],
  ['sim:control', 'screenshot.capture', '-h', '--id', 'session-123'],
  ['simulator:control', '--id', 'session-123', '--help', 'rotate'],
  ['simulators:control', 'rotate', '--help'],
  ['emulator:control', 'rotate', '-h'],
  ['emulators:control', 'rotate', '--help'],
];
const configHelp = [
  ['simulator:control', 'screenshot.capture', '--help', '--output'],
  ['sim:control', 'rotate', '-h', '--id'],
  ['simulator:start', '--help'],
  ['simulator', '--help'],
  ['sim:start', '-h'],
  ['sim', '-h'],
  ['simulators:start', '--help'],
  ['emulator:start', '-h'],
  ['emulators:start', '--help'],
  ['simulators', '--help'],
  ['emulator', '-h'],
  ['emulators', '--help'],
  ['simulators:control', '--help'],
  ['emulator:control', '-h'],
  ['emulators:control', '--help'],
  ['simulator:control', '--help'],
  ['sim:control', '-h'],
  ['--help', 'simulator:start'],
  ['--help', 'help', 'simulator:start'],
  ['simulator:start', '--import', 'does-not-exist.json', '--help'],
  ['simulator:control', '--import', 'does-not-exist.json', '--help'],
];
const ordinaryHelp = [['account:login', '--help'], ['--help']];
const literalHelp = ['simulator:control', 'clipboard.write', '--', '--help'];
let results: {
  stdout: string;
  events: unknown[];
  error?: string;
  commandArgs?: string[];
}[][];

beforeAll(async () => {
  results = await Promise.all(
    modes.map(async mode => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          fixture,
          root,
          JSON.stringify([...actionHelp, ...configHelp, ...ordinaryHelp, literalHelp]),
          mode,
        ],
        { timeout: 20_000 }
      );
      return JSON.parse(stdout.split('LIFECYCLE_RESULT ').at(-1)!);
    })
  );
}, 30_000);

describe.each(modes.map((mode, index) => ({ mode, index })))(
  'simulator help through real oclif routing ($mode)',
  ({ index: mode }) => {
    it.each(actionHelp.map((argv, index) => ({ argv, index })))(
      'keeps command identity and lifecycle hooks for action help: $argv',
      ({ index }) => {
        expect(results[mode][index].error).toBeUndefined();
        expect(results[mode][index].events).toEqual([
          { event: 'prerun', id: 'simulator:control' },
          { event: 'run', id: 'simulator:control' },
          { event: 'postrun', id: 'simulator:control' },
        ]);
      }
    );

    it.each([...configHelp, ...ordinaryHelp].map((argv, index) => ({ argv, index })))(
      'prints help without executing a command: $argv',
      ({ index }) => {
        const { stdout, events, error } = results[mode][index + actionHelp.length];
        expect(error).toBeUndefined();
        expect(stdout).toContain('USAGE');
        expect(events).toEqual([]);
      }
    );

    it('keeps --help after -- as a literal action value', () => {
      const result = results[mode].at(-1)!;
      expect(result.error).toBeUndefined();
      expect(result.commandArgs).toEqual(['clipboard.write', '--', '--help']);
      expect(result.events).toEqual([
        { event: 'prerun', id: 'simulator:control' },
        { event: 'run', id: 'simulator:control' },
        { event: 'postrun', id: 'simulator:control' },
      ]);
    });
  }
);
