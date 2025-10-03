import fs from 'fs-extra';

import { LogSpy } from './testUtils';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { jester } from '../../credentials/__tests__/fixtures-constants';
import { Role } from '../../graphql/generated';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import {
  verifyAccountPermissionsAsync,
  verifyProjectDirectoryDoesNotExistAsync,
  verifyProjectDoesNotExistAsync,
} from '../verifications';

jest.mock('../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync');
jest.mock('fs-extra');

describe('verifications', () => {
  let logSpy: LogSpy;

  beforeAll(() => {
    logSpy = new LogSpy('warn');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    logSpy.restore();
  });

  describe('verifyAccountPermissionsAsync', () => {
    it('should return true when user has sufficient permissions', async () => {
      const actor = {
        ...jester,
        accounts: [
          {
            id: 'account-1',
            name: 'test-account',
            users: [
              {
                actor: { id: jester.id },
                role: Role.Admin,
              },
            ],
          },
        ],
      };

      const result = await verifyAccountPermissionsAsync(actor, 'test-account');
      expect(result).toBe(true);
    });

    it('should return false when user has view-only permissions', async () => {
      const actor = {
        ...jester,
        accounts: [
          {
            id: 'account-1',
            name: 'test-account',
            users: [
              {
                actor: { id: jester.id },
                role: Role.ViewOnly,
              },
            ],
          },
        ],
      };

      const result = await verifyAccountPermissionsAsync(actor, 'test-account');
      expect(result).toBe(false);
      logSpy.expectLogToContain(
        "You don't have permission to create a new project on the test-account account."
      );
    });

    it('should return false when account does not exist', async () => {
      const actor = {
        ...jester,
        accounts: [
          {
            id: 'account-1',
            name: 'existing-account',
            users: [
              {
                actor: { id: jester.id },
                role: Role.Admin,
              },
            ],
          },
        ],
      };

      const result = await verifyAccountPermissionsAsync(actor, 'non-existent-account');
      expect(result).toBe(false);
      logSpy.expectLogToContain(
        "You don't have permission to create a new project on the non-existent-account account."
      );
    });

    it('should return false when user is associated with account but has no permissions', async () => {
      const actor = {
        ...jester,
        accounts: [
          {
            id: 'account-1',
            name: 'test-account',
            users: [
              {
                actor: { id: jester.id },
                role: Role.ViewOnly,
              },
            ],
          },
        ],
      };

      const result = await verifyAccountPermissionsAsync(actor, 'test-account');
      expect(result).toBe(false);
      logSpy.expectLogToContain(
        "You don't have permission to create a new project on the test-account account."
      );
    });
  });

  describe('verifyProjectDoesNotExistAsync', () => {
    it('should return true when project does not exist', async () => {
      const mockGraphqlClient = {} as ExpoGraphqlClient;
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

      const result = await verifyProjectDoesNotExistAsync(
        mockGraphqlClient,
        'test-account',
        'test-project'
      );

      expect(result).toBe(true);
      expect(findProjectIdByAccountNameAndSlugNullableAsync).toHaveBeenCalledWith(
        mockGraphqlClient,
        'test-account',
        'test-project'
      );
    });

    it('should return false when project exists', async () => {
      const mockGraphqlClient = {} as ExpoGraphqlClient;
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue('project-id');

      const result = await verifyProjectDoesNotExistAsync(
        mockGraphqlClient,
        'test-account',
        'test-project'
      );

      expect(result).toBe(false);
      expect(findProjectIdByAccountNameAndSlugNullableAsync).toHaveBeenCalledWith(
        mockGraphqlClient,
        'test-account',
        'test-project'
      );
      logSpy.expectLogToContain('Project @test-account/test-project already exists on the server.');
    });
  });

  describe('verifyProjectDirectoryDoesNotExistAsync', () => {
    it('should return true when directory does not exist', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(false);

      const result = await verifyProjectDirectoryDoesNotExistAsync('/non-existent-directory');

      expect(result).toBe(true);
      expect(fs.pathExists).toHaveBeenCalledWith('/non-existent-directory');
    });

    it('should return false when directory exists', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(true);

      const result = await verifyProjectDirectoryDoesNotExistAsync('/existing-directory');

      expect(result).toBe(false);
      expect(fs.pathExists).toHaveBeenCalledWith('/existing-directory');
      logSpy.expectLogToContain('Directory /existing-directory already exists.');
    });
  });
});
