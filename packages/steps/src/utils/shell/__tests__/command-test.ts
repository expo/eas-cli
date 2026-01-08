import { getShellCommandAndArgs } from '../command.js';

describe(getShellCommandAndArgs, () => {
  test('shell command with arguments', () => {
    const { command, args } = getShellCommandAndArgs(
      '/bin/bash -eo pipefail',
      '/path/to/script.sh'
    );
    expect(command).toBe('/bin/bash');
    expect(args).toEqual(['-eo', 'pipefail', '/path/to/script.sh']);
  });
  test('shell command without arguments', () => {
    const { command, args } = getShellCommandAndArgs('/bin/bash', '/path/to/script.sh');
    expect(command).toBe('/bin/bash');
    expect(args).toEqual(['/path/to/script.sh']);
  });
});
