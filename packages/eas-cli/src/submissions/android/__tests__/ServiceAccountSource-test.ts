import { vol } from 'memfs';

import { asMock } from '../../../__tests__/utils';
import { findProjectRootAsync } from '../../../project/projectUtils';
import { promptAsync } from '../../../prompts';
import {
  ServiceAccountSource,
  ServiceAccountSourceType,
  getServiceAccountAsync,
} from '../ServiceAccountSource';

jest.mock('fs');
jest.mock('../../../prompts');
jest.mock('../../../project/projectUtils');

describe(getServiceAccountAsync, () => {
  beforeAll(() => {
    const mockDetectableServiceAccountJson = JSON.stringify({
      type: 'service_account',
    });

    vol.fromJSON({
      '/google-service-account.json': JSON.stringify({ service: 'account' }),
      '/project_dir/subdir/service-account.json': mockDetectableServiceAccountJson,
      '/project_dir/another-service-account.json': mockDetectableServiceAccountJson,
      '/other_dir/invalid_file.txt': 'this is not even a JSON',
    });
  });
  afterAll(() => {
    vol.reset();
  });

  afterEach(() => {
    asMock(promptAsync).mockClear();
  });

  describe('when source is ServiceAccountSourceType.path', () => {
    it("prompts for path if the provided file doesn't exist", async () => {
      asMock(promptAsync).mockImplementationOnce(() => ({
        filePath: '/google-service-account.json',
      }));
      const source: ServiceAccountSource = {
        sourceType: ServiceAccountSourceType.path,
        path: '/doesnt-exist.json',
      };
      const serviceAccountPath = await getServiceAccountAsync(source);
      expect(promptAsync).toHaveBeenCalled();
      expect(serviceAccountPath).toBe('/google-service-account.json');
    });

    it("doesn't prompt for path if the provided file exists", async () => {
      const source: ServiceAccountSource = {
        sourceType: ServiceAccountSourceType.path,
        path: '/google-service-account.json',
      };
      await getServiceAccountAsync(source);
      expect(promptAsync).not.toHaveBeenCalled();
    });

    it('returns the provided file path if the file exists', async () => {
      const source: ServiceAccountSource = {
        sourceType: ServiceAccountSourceType.path,
        path: '/google-service-account.json',
      };
      const serviceAccountPath = await getServiceAccountAsync(source);
      expect(serviceAccountPath).toBe('/google-service-account.json');
    });
  });

  describe('when source is ServiceAccountSourceType.prompt', () => {
    it('prompts for path', async () => {
      asMock(promptAsync).mockImplementationOnce(() => ({
        filePath: '/google-service-account.json',
      }));
      const source: ServiceAccountSource = {
        sourceType: ServiceAccountSourceType.prompt,
      };
      const serviceAccountPath = await getServiceAccountAsync(source);
      expect(promptAsync).toHaveBeenCalled();
      expect(serviceAccountPath).toBe('/google-service-account.json');
    });

    it('prompts for path until the user provides an existing file', async () => {
      asMock(promptAsync)
        .mockImplementationOnce(() => ({
          filePath: '/doesnt-exist.json',
        }))
        .mockImplementationOnce(() => ({
          filePath: '/googl-service-account.json',
        }))
        .mockImplementationOnce(() => ({
          filePath: '/google-service-account.json',
        }));
      const source: ServiceAccountSource = {
        sourceType: ServiceAccountSourceType.prompt,
      };
      const serviceAccountPath = await getServiceAccountAsync(source);
      expect(promptAsync).toHaveBeenCalledTimes(3);
      expect(serviceAccountPath).toBe('/google-service-account.json');
    });
  });

  describe('when source is ServiceAccountSourceType.detect', () => {
    it('detects a single google-services file and prompts for confirmation', async () => {
      asMock(findProjectRootAsync).mockResolvedValueOnce('/project_dir/subdir'); // should find 1 file
      asMock(promptAsync).mockResolvedValueOnce({
        confirmed: true,
      });

      const serviceAccountPath = await getServiceAccountAsync({
        sourceType: ServiceAccountSourceType.detect,
      });

      expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ type: 'confirm' }));
      expect(serviceAccountPath).toBe('/project_dir/subdir/service-account.json');
    });

    it('falls back to prompt, when no valid files are found in the dir', async () => {
      asMock(findProjectRootAsync).mockResolvedValueOnce('/other_dir'); // no valid files in that dir
      asMock(promptAsync).mockResolvedValueOnce({
        filePath: '/google-service-account.json',
      });

      const serviceAccountPath = await getServiceAccountAsync({
        sourceType: ServiceAccountSourceType.detect,
      });

      expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ type: 'text' }));
      expect(serviceAccountPath).toBe('/google-service-account.json');
    });

    it('falls back to prompt, when user rejects to use detected file', async () => {
      asMock(findProjectRootAsync).mockResolvedValueOnce('/project_dir/subdir'); // should find 1 file
      asMock(promptAsync)
        .mockResolvedValueOnce({
          confirmed: false,
        })
        .mockResolvedValueOnce({
          filePath: '/google-service-account.json',
        });
      const source: ServiceAccountSource = {
        sourceType: ServiceAccountSourceType.detect,
      };

      const serviceAccountPath = await getServiceAccountAsync(source);

      expect(promptAsync).toHaveBeenCalledTimes(2);
      expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ type: 'confirm' }));
      expect(promptAsync).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'text' }));
      expect(serviceAccountPath).toBe('/google-service-account.json');
    });

    it('displays a chooser, when multiple files are found', async () => {
      asMock(findProjectRootAsync).mockResolvedValueOnce('/project_dir'); // should find 2 files here
      asMock(promptAsync).mockResolvedValueOnce({
        selectedPath: '/project_dir/another-service-account.json',
      });

      const serviceAccountPath = await getServiceAccountAsync({
        sourceType: ServiceAccountSourceType.detect,
      });

      const expectedChoices = expect.arrayContaining([
        expect.objectContaining({ value: '/project_dir/another-service-account.json' }),
        expect.objectContaining({ value: '/project_dir/subdir/service-account.json' }),
        expect.objectContaining({ value: false }),
      ]);

      expect(promptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'select',
          choices: expectedChoices,
        })
      );
      expect(serviceAccountPath).toBe('/project_dir/another-service-account.json');
    });

    it('falls back to prompt, when user selects the "None of above"', async () => {
      asMock(findProjectRootAsync).mockResolvedValueOnce('/project_dir'); // should find 2 files here
      asMock(promptAsync)
        .mockResolvedValueOnce({
          selectedPath: false,
        })
        .mockResolvedValueOnce({
          filePath: '/google-service-account.json',
        });

      const serviceAccountPath = await getServiceAccountAsync({
        sourceType: ServiceAccountSourceType.detect,
      });

      expect(promptAsync).toHaveBeenCalledTimes(2);
      expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ type: 'select' }));
      expect(promptAsync).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'text' }));
      expect(serviceAccountPath).toBe('/google-service-account.json');
    });
  });
});
