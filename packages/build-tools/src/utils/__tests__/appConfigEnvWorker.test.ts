import { get } from '@expo/env';

import { runAppConfigEnvWorker } from '../appConfigEnvWorker';

jest.mock('@expo/env', () => ({
  get: jest.fn(),
}));

const getEnvMock = jest.mocked(get);

describe(runAppConfigEnvWorker, () => {
  it('writes the production dotenv vars as JSON', () => {
    const stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    getEnvMock.mockReturnValue({
      env: { FROM_PRODUCTION_DOTENV: 'true' },
      files: ['/project/.env.production'],
    });

    try {
      runAppConfigEnvWorker('/project');

      expect(getEnvMock).toHaveBeenCalledWith('/project', {
        force: true,
        silent: true,
      });
      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        JSON.stringify({ FROM_PRODUCTION_DOTENV: 'true' })
      );
    } finally {
      stdoutWriteSpy.mockRestore();
    }
  });
});
