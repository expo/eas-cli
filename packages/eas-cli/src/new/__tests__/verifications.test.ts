import fs from 'fs-extra';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { jester } from '../../credentials/__tests__/fixtures-constants';
import { Role } from '../../graphql/generated';
import Log from '../../log';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import {
  verifyAccountPermissionsAsync,
  verifyProjectDirectoryDoesNotExistAsync,
  verifyProjectDoesNotExistAsync,
} from '../verifications';

jest.mock('../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync');
jest.mock('fs-extra');

describe('verifications', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(Log, 'warn');
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // Helper function to get all log output as strings
  const getLogOutput = (): string[] => {
    return logSpy.mock.calls.map(call => (call.length === 0 ? '' : call.join(' ')));
  };

  // Helper function to check if a specific message was logged
  const expectLogToContain = (message: string): void => {
    const output = getLogOutput();
    // strip out ANSI codes and special characters like the tick
    const outputWithoutAnsi = output.map(line =>
      line.replace(/\x1b\[[0-9;]*m/g, '').replace(/✔\s*/, '')
    );
    expect(outputWithoutAnsi.some(line => line.includes(message))).toBeTruthy();
  };

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
      expectLogToContain(
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
      expectLogToContain(
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
      expectLogToContain(
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
      expectLogToContain('Project @test-account/test-project already exists on the server.');
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
      expectLogToContain('Directory /existing-directory already exists.');
    });
  });
});
