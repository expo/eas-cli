import path from 'node:path';

const realFs = jest.requireActual<typeof import('node:fs')>('node:fs');

/** The lines of a capture of an agent's stdout; ids and local details replaced, text in English. */
export function readFixtureLines(name: string): string[] {
  return realFs
    .readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
    .split('\n')
    .filter(line => line !== '');
}
