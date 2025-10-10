import { selectAsync } from '../../prompts';
import { PackageManager, promptForPackageManagerAsync } from '../installDependencies';

jest.mock('../../prompts');

describe('installDependencies', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('promptForPackageManagerAsync', () => {
    it.each(['npm', 'yarn', 'pnpm', 'bun'])(
      'returns %s when user selects %s',
      async packageManager => {
        jest.mocked(selectAsync).mockResolvedValue(packageManager as PackageManager);

        const result = await promptForPackageManagerAsync();
        expect(selectAsync).toHaveBeenCalledWith(
          'Which package manager would you like to use?',
          [
            { title: 'bun', value: 'bun' },
            { title: 'npm', value: 'npm' },
            { title: 'pnpm', value: 'pnpm' },
            { title: 'yarn', value: 'yarn' },
          ],
          { initial: 'npm' }
        );

        expect(result).toBe(packageManager);
      }
    );

    it('defaults to npm as initial selection', async () => {
      jest.mocked(selectAsync).mockResolvedValue('npm');

      await promptForPackageManagerAsync();

      expect(selectAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ initial: 'npm' })
      );
    });
  });
});
