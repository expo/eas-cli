import { Config } from '@oclif/core';

import Log from '../../../log';
import { runLocalEgressAsync } from '../../../simulator/egress';
import { loadSimulatorEnvAsync } from '../../../simulator/env';
import SimulatorEgress from '../egress';

jest.mock('../../../log');
jest.mock('../../../simulator/env', () => ({
  ...jest.requireActual('../../../simulator/env'),
  loadSimulatorEnvAsync: jest.fn(),
}));
jest.mock('../../../simulator/egress', () => ({
  ...jest.requireActual('../../../simulator/egress'),
  runLocalEgressAsync: jest.fn(),
}));

const shellSession = {
  EAS_SIMULATOR_SESSION_ID: 'session-b',
  EAS_SIMULATOR_EGRESS_URL: 'https://egress-b.example.test',
  EAS_SIMULATOR_EGRESS_TOKEN: 'token-b',
  EAS_SIMULATOR_EGRESS_FINGERPRINT: 'fingerprint-b',
  EAS_SIMULATOR_EGRESS_PORT: '8899',
};
const fileSession = {
  EAS_SIMULATOR_SESSION_ID: 'session-a',
  EAS_SIMULATOR_EGRESS_URL: 'https://egress-a.example.test',
  EAS_SIMULATOR_EGRESS_TOKEN: 'token-a',
  EAS_SIMULATOR_EGRESS_FINGERPRINT: 'fingerprint-a',
  EAS_SIMULATOR_EGRESS_PORT: '8898',
};

function createCommand(argv: string[]): SimulatorEgress {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({ failures: [], successes: [] });
  const command = new SimulatorEgress(argv, config);
  // @ts-expect-error getContextAsync is protected
  jest.spyOn(command, 'getContextAsync').mockResolvedValue({ projectDir: '/test/project' });
  return command;
}

describe(SimulatorEgress, () => {
  const previousEnv = Object.fromEntries(
    Object.keys(shellSession).map(key => [key, process.env[key]])
  );
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(process.env, shellSession);
    jest.mocked(loadSimulatorEnvAsync).mockImplementation(async () => {
      Object.assign(process.env, fileSession);
    });
    jest.mocked(runLocalEgressAsync).mockResolvedValue();
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('uses the complete exported session tuple without loading a stale dotenv session in env mode', async () => {
    await createCommand(['--config-type', 'env']).runAsync();

    expect(loadSimulatorEnvAsync).not.toHaveBeenCalled();
    expect(runLocalEgressAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        url: shellSession.EAS_SIMULATOR_EGRESS_URL,
        token: shellSession.EAS_SIMULATOR_EGRESS_TOKEN,
        fingerprint: shellSession.EAS_SIMULATOR_EGRESS_FINGERPRINT,
        port: 8899,
      })
    );
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('session-b'));
    expect(Log.log).toHaveBeenCalledWith(
      expect.stringContaining('eas simulator:stop --id session-b')
    );
  });

  it.each([[], ['--config-type', 'dotenv']])(
    'loads the managed session by default or with explicit dotenv selection (%j)',
    async (...argv) => {
      await createCommand(argv).runAsync();

      expect(loadSimulatorEnvAsync).toHaveBeenCalledWith('/test/project');
      expect(runLocalEgressAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          url: fileSession.EAS_SIMULATOR_EGRESS_URL,
          token: fileSession.EAS_SIMULATOR_EGRESS_TOKEN,
          fingerprint: fileSession.EAS_SIMULATOR_EGRESS_FINGERPRINT,
          port: 8898,
        })
      );
      expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('session-a'));
    }
  );

  it('does not fill missing exported credentials from a stale file in env mode', async () => {
    delete process.env.EAS_SIMULATOR_EGRESS_TOKEN;

    await expect(createCommand(['--config-type', 'env']).runAsync()).rejects.toThrow(
      'no egress client to run'
    );

    expect(loadSimulatorEnvAsync).not.toHaveBeenCalled();
    expect(runLocalEgressAsync).not.toHaveBeenCalled();
  });
});
