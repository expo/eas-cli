import { CredentialsSource, Workflow } from '@eas/config';
import prompts from 'prompts';

import { asMock } from '../../__tests__/utils';
import { CredentialsProvider } from '../../credentials/CredentialsProvider';
import { ensureCredentialsAsync } from '../credentials';

jest.mock('prompts');

function createMockCredentialsProvider({
  hasRemote,
  hasLocal,
  isLocalSynced,
}: any): CredentialsProvider {
  return {
    platform: 'android',
    hasRemoteAsync: jest.fn().mockImplementation(() => hasRemote || false),
    hasLocalAsync: jest.fn().mockImplementation(() => hasLocal || false),
    isLocalSyncedAsync: jest.fn().mockImplementation(() => isLocalSynced || false),
  } as CredentialsProvider;
}

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
});
afterAll(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
});

beforeEach(() => {
  asMock(prompts).mockReset();
  asMock(prompts).mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
});

describe(ensureCredentialsAsync, () => {
  describe('for generic builds', () => {
    it("should use credentials.json if it's the only available credentials", async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: false,
        hasLocal: true,
      });
      const src = await ensureCredentialsAsync(
        provider,
        Workflow.Generic,
        CredentialsSource.AUTO,
        false
      );
      expect(src).toBe('local');
    });
    it("should use credentials from server if it's the only available credentials", async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: true,
        hasLocal: false,
      });
      const src = await ensureCredentialsAsync(
        provider,
        Workflow.Generic,
        CredentialsSource.AUTO,
        false
      );
      expect(src).toBe('remote');
    });
    it('should use credentials.json if credentials are the same in credentials.json and on server', async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: true,
        hasLocal: true,
        isLocalSynced: true,
      });
      const src = await ensureCredentialsAsync(
        provider,
        Workflow.Generic,
        CredentialsSource.AUTO,
        false
      );
      expect(prompts).toHaveBeenCalledTimes(0);
      expect(src).toBe('local');
    });
    it('should ask which credentials to use when local and remote crednitals have different values', async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: true,
        hasLocal: true,
        isLocalSynced: false,
      });
      asMock(prompts).mockImplementationOnce(() => {
        return { select: 'local' };
      });
      const src = await ensureCredentialsAsync(
        provider,
        Workflow.Generic,
        CredentialsSource.AUTO,
        false
      );
      expect(prompts).toHaveBeenCalledTimes(1);
      expect(src).toBe('local');
    });
    it('should ask when local and remote are not the same (select remote)', async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: true,
        hasLocal: true,
        isLocalSynced: false,
      });
      asMock(prompts).mockImplementationOnce(() => {
        return { select: 'remote' };
      });
      const src = await ensureCredentialsAsync(
        provider,
        Workflow.Generic,
        CredentialsSource.AUTO,
        false
      );
      expect(prompts).toHaveBeenCalledTimes(1);
      expect(src).toBe('remote');
    });
    it('should should throw an error when local and remote are not the same (in non interactive mode)', async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: true,
        hasLocal: true,
        isLocalSynced: false,
      });

      try {
        await ensureCredentialsAsync(provider, Workflow.Generic, CredentialsSource.AUTO, true);
        throw new Error('ensureCredentialsAsync should throw an Error');
      } catch (e) {
        expect(e.message).toMatch(
          'Contents of your local credentials.json for Android are not the same as credentials on Expo servers'
        );
      }

      expect(prompts).toHaveBeenCalledTimes(0);
    });
    it('should ask when no credentials are present and return remote if confirm=true', async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: false,
        hasLocal: false,
        isLocalSynced: false,
      });
      asMock(prompts).mockImplementationOnce(() => {
        return { value: true }; //confirm
      });
      const src = await ensureCredentialsAsync(
        provider,
        Workflow.Generic,
        CredentialsSource.AUTO,
        false
      );
      expect(prompts).toHaveBeenCalledTimes(1);
      expect(src).toBe('remote');
    });
    it('should ask when no credentials are present and abort if confimr=false', async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: false,
        hasLocal: false,
        isLocalSynced: false,
      });
      asMock(prompts).mockImplementationOnce(() => {
        return { value: false }; //confirm
      });

      try {
        await ensureCredentialsAsync(provider, Workflow.Generic, CredentialsSource.AUTO, false);
        throw new Error('ensureCredentialsAsync should throw an Error');
      } catch (e) {
        expect(e.message).toMatch(
          'Aborting build process, credentials are not configured for Android'
        );
      }

      expect(prompts).toHaveBeenCalledTimes(1);
    });
    it('should throw an error when no credentials are present in non interactive mode', async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: false,
        hasLocal: false,
        isLocalSynced: false,
      });
      asMock(prompts).mockImplementation(() => {
        return { value: true }; // confirm
      });

      try {
        await ensureCredentialsAsync(provider, Workflow.Generic, CredentialsSource.AUTO, true);
        throw new Error('ensureCredentialsAsync should throw an Error');
      } catch (e) {
        expect(e.message).toMatch('Credentials for this app are not configured');
      }

      expect(prompts).toHaveBeenCalledTimes(0);
    });
  });

  describe('for managed builds', () => {
    it("should use credentials.json if it's the only available credentials", async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: false,
        hasLocal: true,
      });
      const src = await ensureCredentialsAsync(
        provider,
        Workflow.Managed,
        CredentialsSource.AUTO,
        false
      );
      expect(src).toBe('local');
    });
    it("should use credentials from server if it's the only available credentials", async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: true,
        hasLocal: false,
      });
      const src = await ensureCredentialsAsync(
        provider,
        Workflow.Managed,
        CredentialsSource.AUTO,
        false
      );
      expect(src).toBe('remote');
    });
    it('should use credentials.json if credentials are the same in credentials.json and on server', async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: true,
        hasLocal: true,
        isLocalSynced: true,
      });
      const src = await ensureCredentialsAsync(
        provider,
        Workflow.Managed,
        CredentialsSource.AUTO,
        false
      );
      expect(prompts).toHaveBeenCalledTimes(0);
      expect(src).toBe('local');
    });

    it('should use credentials.json even if credentials on server are different', async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: true,
        hasLocal: true,
        isLocalSynced: false,
      });
      const src = await ensureCredentialsAsync(
        provider,
        Workflow.Managed,
        CredentialsSource.AUTO,
        false
      );
      expect(prompts).toHaveBeenCalledTimes(0);
      expect(src).toBe('local');
    });
  });

  describe('generic builds with credentialsSource set to local', () => {
    it('should use credentials.json without asking even if credentials on server are different', async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: true,
        hasLocal: true,
        isLocalSynced: false,
      });
      const src = await ensureCredentialsAsync(
        provider,
        Workflow.Generic,
        CredentialsSource.LOCAL,
        false
      );
      expect(prompts).toHaveBeenCalledTimes(0);
      expect(src).toBe('local');
    });
  });

  describe('generic builds with credentialsSource set to remote', () => {
    it('should use credentials from server even if credentials.json exists and have different values', async () => {
      const provider = createMockCredentialsProvider({
        hasRemote: true,
        hasLocal: true,
        isLocalSynced: false,
      });
      const src = await ensureCredentialsAsync(
        provider,
        Workflow.Generic,
        CredentialsSource.REMOTE,
        false
      );
      expect(prompts).toHaveBeenCalledTimes(0);
      expect(src).toBe('remote');
    });
  });
});
