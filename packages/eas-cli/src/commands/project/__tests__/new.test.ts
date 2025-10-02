import fs from 'fs-extra';

import New from '../new';

jest.mock('../../../prompts');
jest.mock('../../../onboarding/git');
jest.mock('../../../onboarding/runCommand');
jest.mock('../../../graphql/mutations/AppMutation');
jest.mock('../../../project/expoConfig');
jest.mock('../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync');
jest.mock('../../../user/User', () => ({
  getActorUsername: jest.fn(),
}));
jest.mock('../../../ora');
jest.mock('fs-extra');
jest.mock('../../../onboarding/installDependencies');
jest.mock('../../../api');
jest.mock('../../../build/utils/url');
jest.mock('../../../utils/easCli', () => ({
  easCliVersion: '5.0.0',
}));

describe(New.name, () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Capture console.log calls
    consoleLogSpy = jest.spyOn(console, 'log');

    jest.mocked(fs.writeFile).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.readJson).mockImplementation(() => Promise.resolve({}));
    jest.mocked(fs.writeJson).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.copy).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.remove).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.readFile).mockImplementation(() => Promise.resolve(''));
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('integration tests', () => {
    it('should run the complete new project flow', async () => {
      // This is a placeholder for integration tests
      // The individual function tests have been moved to their respective test files
      expect(true).toBe(true);
    });
  });
});
