import dotenv from 'dotenv';
import * as fs from 'fs-extra';

import { EnvironmentVariableVisibility } from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { mergeEnvContent, writeEnvLocalAsync } from '../envFile';

jest.mock('fs-extra');
jest.mock('../../../prompts');
jest.mock('../../../log');

const LABEL = 'Example';
const VAR_NAME = 'EXPO_PUBLIC_EXAMPLE_URL';

const envVars = [
  {
    name: VAR_NAME,
    value: 'https://new.example.test',
    visibility: EnvironmentVariableVisibility.Public,
  },
];

describe('mergeEnvContent', () => {
  it('updates existing keys and appends new ones', () => {
    expect(mergeEnvContent('FOO=1\n', { FOO: '2', BAR: '3' })).toBe('FOO=2\nBAR=3\n');
    expect(mergeEnvContent('FOO=1', { BAR: '3' })).toBe('FOO=1\nBAR=3\n');
  });

  it('replaces rather than duplicates keys written with spaces around the equals sign', () => {
    expect(mergeEnvContent('FOO = 1\n', { FOO: '2' })).toBe('FOO=2\n');
  });

  it('replaces rather than duplicates keys written with an export prefix, keeping the prefix', () => {
    expect(mergeEnvContent('export FOO=1\n', { FOO: '2' })).toBe('export FOO=2\n');
  });

  it('replaces indented keys, keeping the existing indentation', () => {
    expect(mergeEnvContent('  FOO=1\n', { FOO: '2' })).toBe('  FOO=2\n');
  });

  it('writes values containing regex replacement patterns verbatim', () => {
    expect(mergeEnvContent('FOO=1\n', { FOO: 'a$&b$1c' })).toBe('FOO=a$&b$1c\n');
  });

  it('does not treat a commented-out key as present', () => {
    expect(mergeEnvContent('#FOO=1\n', { FOO: '2' })).toBe('#FOO=1\nFOO=2\n');
  });

  it('replaces keys written in the colon form dotenv accepts', () => {
    expect(mergeEnvContent('FOO: 1\n', { FOO: '2' })).toBe('FOO=2\n');
  });

  it('collapses duplicate definitions so a later stale one cannot win', () => {
    expect(mergeEnvContent('export FOO=1\nFOO=stale\n', { FOO: '2' })).toBe('export FOO=2\n');
    expect(mergeEnvContent('FOO=a\nFOO=b\nFOO=c\n', { FOO: '2' })).toBe('FOO=2\n');
    expect(mergeEnvContent('A=1\nFOO=old\nB=2\nFOO=stale\nC=3\n', { FOO: '2' })).toBe(
      'A=1\nFOO=2\nB=2\nC=3\n'
    );
  });

  it('keeps comments that follow, or trail, a replaced definition', () => {
    expect(mergeEnvContent('FOO=1\n# keep\n', { FOO: '2' })).toBe('FOO=2\n# keep\n');
    expect(mergeEnvContent('FOO=1\n\n\n# keep\nBAR=2\n', { FOO: '2' })).toBe(
      'FOO=2\n\n\n# keep\nBAR=2\n'
    );
    expect(mergeEnvContent('FOO=1 # keep\n', { FOO: '2' })).toBe('FOO=2 # keep\n');
  });

  it('keeps CRLF line endings intact when collapsing duplicates', () => {
    expect(mergeEnvContent('FOO=1\r\nBAR=2\r\nFOO=3\r\nBAZ=4\r\n', { FOO: 'new' })).toBe(
      'FOO=new\r\nBAR=2\r\nBAZ=4\r\n'
    );
    expect(mergeEnvContent('FOO=1\r\nFOO=2\r\nFOO=3\r\n', { FOO: 'new' })).toBe('FOO=new\r\n');
  });

  it('quotes values that would not otherwise read back unchanged', () => {
    expect(mergeEnvContent('', { FOO: 'secret#123' })).toBe('FOO="secret#123"\n');
    expect(mergeEnvContent('', { FOO: '  padded' })).toBe('FOO="  padded"\n');
    expect(mergeEnvContent('', { FOO: "'sq'" })).toBe('FOO="\'sq\'"\n');
    expect(mergeEnvContent('', { FOO: 'line\nbreak' })).toBe('FOO="line\\nbreak"\n');
  });

  it('leaves plain values unquoted', () => {
    expect(mergeEnvContent('', { FOO: 'https://x.supabase.co' })).toBe(
      'FOO=https://x.supabase.co\n'
    );
  });

  it('cannot be used to inject another variable through a value', () => {
    const merged = mergeEnvContent('BAR=keep\n', { FOO: 'x\nBAR=hijacked' });
    expect(dotenv.parse(merged).BAR).toBe('keep');
    expect(dotenv.parse(merged).FOO).toBe('x\nBAR=hijacked');
  });

  it('does not treat a key inside another quoted value as a definition', () => {
    const raw = 'PRIVATE_KEY="-----BEGIN-----\nFOO=notavar\n-----END-----"\nOTHER=1\n';
    expect(mergeEnvContent(raw, { FOO: '2' })).toBe(`${raw}FOO=2\n`);
  });

  it('replaces a multi-line quoted value without orphaning its remaining lines', () => {
    expect(mergeEnvContent('FOO="header\nBAR=leaked"\nOTHER=1\n', { FOO: '2' })).toBe(
      'FOO=2\nOTHER=1\n'
    );
  });
});

describe('writeEnvLocalAsync', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(fs.pathExists).mockResolvedValue(false as never);
    jest.mocked(fs.writeFile).mockResolvedValue(undefined as never);
  });

  it('writes a new .env.local file', async () => {
    await expect(
      writeEnvLocalAsync('/project', envVars, {
        label: LABEL,
        nonInteractive: true,
        overwrite: false,
      })
    ).resolves.toBe(true);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.env.local'),
      expect.stringContaining(VAR_NAME)
    );
    expect(Log.withTick).toHaveBeenCalled();
  });

  it('skips conflicts in non-interactive mode without overwrite', async () => {
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest.mocked(fs.readFile).mockResolvedValue(`${VAR_NAME}=old\n` as never);

    await expect(
      writeEnvLocalAsync('/project', envVars, {
        label: LABEL,
        nonInteractive: true,
        overwrite: false,
      })
    ).resolves.toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('skipped'));
  });

  it('prompts on conflicts interactively and skips when declined', async () => {
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest.mocked(fs.readFile).mockResolvedValue(`${VAR_NAME}=old\n` as never);
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await expect(
      writeEnvLocalAsync('/project', envVars, {
        label: LABEL,
        nonInteractive: false,
        overwrite: false,
      })
    ).resolves.toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('overwrites conflicts when confirmed or --overwrite', async () => {
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest.mocked(fs.readFile).mockResolvedValue(`${VAR_NAME}=old\n` as never);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await expect(
      writeEnvLocalAsync('/project', envVars, {
        label: LABEL,
        nonInteractive: false,
        overwrite: false,
      })
    ).resolves.toBe(true);
    await expect(
      writeEnvLocalAsync('/project', envVars, {
        label: LABEL,
        nonInteractive: true,
        overwrite: true,
      })
    ).resolves.toBe(true);
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it('replaces a conflicting export-prefixed key instead of leaving a stale line', async () => {
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest.mocked(fs.readFile).mockResolvedValue(`export ${VAR_NAME}=old\n` as never);

    await expect(
      writeEnvLocalAsync('/project', envVars, {
        label: LABEL,
        nonInteractive: true,
        overwrite: true,
      })
    ).resolves.toBe(true);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.env.local'),
      `export ${VAR_NAME}=https://new.example.test\n`
    );
  });
});
