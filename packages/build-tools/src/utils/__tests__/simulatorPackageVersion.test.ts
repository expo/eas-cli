import spawn from '@expo/turtle-spawn';

import { resolveSimulatorPackageVersionAsync } from '../simulatorPackageVersion';

jest.mock('@expo/turtle-spawn');

beforeEach(() => jest.resetAllMocks());

it.each(['1.2.3', 'v1.2.3', '1.2.3-beta.1', '1.2.3-beta.1+build.2', 'v1.2.3+build.2'])(
  'compares an exact request without a registry call (%s)',
  async requested => {
    await expect(
      resolveSimulatorPackageVersionAsync('serve-sim', requested, { env: {} })
    ).resolves.toBe(requested.replace(/^v/, ''));
    expect(spawn).not.toHaveBeenCalled();
  }
);

it.each([
  ['serve-sim', '@expo/serve-sim'],
  ['agent-device', 'agent-device'],
  ['argent', '@swmansion/argent'],
  ['appium', 'appium'],
] as const)('checks the current dist-tag for %s', async (engine, name) => {
  jest.mocked(spawn).mockResolvedValue({ stdout: '"1.2.4"' } as never);
  const env = { NPM_CONFIG_REGISTRY: 'https://registry.example' };
  const signal = new AbortController().signal;
  await expect(
    resolveSimulatorPackageVersionAsync(engine, 'latest', { env, signal })
  ).resolves.toBe('1.2.4');
  expect(spawn).toHaveBeenCalledWith(
    'npm',
    [
      'view',
      `${name}@latest`,
      'version',
      '--json',
      '--prefer-online',
      '--prefer-offline=false',
      '--offline=false',
      '--fetch-retries=0',
    ],
    { env, signal, stdio: 'pipe', timeout: 30_000 }
  );
});

it('selects the newest matching version from range metadata without relying on output order', async () => {
  jest.mocked(spawn).mockResolvedValue({ stdout: '["3.9.0","3.10.0","3.8.0"]' } as never);
  await expect(resolveSimulatorPackageVersionAsync('appium', '^3', { env: {} })).resolves.toBe(
    '3.10.0'
  );
});

it.each(['not json', '{}', '[]', '"latest"'])(
  'rejects unusable registry output (%s)',
  async stdout => {
    jest.mocked(spawn).mockResolvedValue({ stdout } as never);
    await expect(
      resolveSimulatorPackageVersionAsync('serve-sim', 'latest', { env: {} })
    ).rejects.toThrow();
  }
);

it('preserves registry lookup failures instead of trusting the prepared version', async () => {
  const error = new Error('registry unavailable');
  jest.mocked(spawn).mockRejectedValue(error);
  await expect(resolveSimulatorPackageVersionAsync('argent', 'latest', { env: {} })).rejects.toBe(
    error
  );
});

it('does not look up a cancelled request', async () => {
  const signal = AbortSignal.abort(new Error('cancelled'));
  await expect(
    resolveSimulatorPackageVersionAsync('serve-sim', 'latest', { env: {}, signal })
  ).rejects.toThrow('cancelled');
  expect(spawn).not.toHaveBeenCalled();
});
