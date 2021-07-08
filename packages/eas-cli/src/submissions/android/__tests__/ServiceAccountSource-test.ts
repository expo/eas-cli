import { vol } from 'memfs';

import { asMock } from '../../../__tests__/utils';
import { promptAsync } from '../../../prompts';
import {
  ServiceAccountSource,
  ServiceAccountSourceType,
  getServiceAccountAsync,
} from '../ServiceAccountSource';

jest.mock('fs');
jest.mock('../../../prompts');

describe(getServiceAccountAsync, () => {
  beforeAll(() => {
    vol.fromJSON({
      '/google-service-account.json': JSON.stringify({ service: 'account' }),
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
});
