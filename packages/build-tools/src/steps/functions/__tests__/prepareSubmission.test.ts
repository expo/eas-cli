import { Platform } from '@expo/eas-build-job';
import { Client, CombinedError } from '@urql/core';
import fs from 'fs-extra';
import { vol } from 'memfs';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { CustomBuildContext } from '../../../customBuildContext';
import { SubmissionCredentials } from '../../utils/submission/credentials';
import { prepareSubmissionAsync } from '../../utils/submission/prepareSubmission';
import {
  createCleanupSubmissionFunction,
  createPrepareSubmissionFunction,
} from '../prepareSubmission';

const buildId = '4e8bd9d8-389e-46bd-91ae-7fc03583020a';
const appId = 'ac064a3e-8d6f-44a7-8df9-f57332e6120a';
const individualKey = { key_id: 'ABC123', key: 'private-key' };
const googleKey = JSON.stringify({
  type: 'service_account',
  private_key: 'private-key',
  client_email: 'service@example.com',
});

function createOptions() {
  return {
    platform: Platform.IOS,
    buildId,
    profileName: 'production' as string | undefined,
    applicationIdentifier: 'com.example.artifact',
    workingDirectory: '/project',
    credentialsDirectory: '/secrets/credentials',
    credentials: {
      validateBuildAsync: jest.fn().mockResolvedValue('production'),
      getAscKeyAsync: jest.fn().mockResolvedValue(individualKey),
      getGoogleKeyAsync: jest.fn().mockResolvedValue(googleKey),
    },
    env: {} as NodeJS.ProcessEnv,
    ensureTestFlightSetupAsync: jest.fn().mockResolvedValue(undefined),
    logger: createMockLogger(),
  };
}

beforeEach(() => {
  vol.fromJSON({
    '/project/app.config.js': 'throw new Error("App config must not run during submission");',
    '/project/package.json': JSON.stringify({ scripts: { postinstall: 'exit 1' } }),
    '/project/eas.json': JSON.stringify({
      submit: { production: { ios: { ascAppId: '123456' }, android: {} } },
    }),
  });
});

describe(prepareSubmissionAsync, () => {
  it('resolves an individual key with no node_modules and without evaluating app config', async () => {
    const options = createOptions();
    const outputs = await prepareSubmissionAsync(options);
    expect(await fs.pathExists('/project/node_modules')).toBe(false);
    expect(options.credentials.getAscKeyAsync).toHaveBeenCalledWith('com.example.artifact');
    expect(await fs.readJson(outputs.json_key_path!)).toEqual(individualKey);
    expect((await fs.stat(outputs.json_key_path!)).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(outputs)).not.toContain('private-key');
    expect(outputs.asc_app_identifier).toBe('123456');
    expect(options.ensureTestFlightSetupAsync).toHaveBeenCalledWith(individualKey, '123456');
  });

  it('resolves inherited profile fields with the step environment', async () => {
    await fs.writeJson('/project/eas.json', {
      submit: {
        base: { ios: { ascAppId: '123456', groups: ['internal'] } },
        production: {
          extends: 'base',
          ios: {
            ascApiKeyPath: '$KEY_PATH',
            ascApiKeyId: 'ABC123',
            bundleIdentifier: 'com.example.override',
          },
        },
      },
    });
    await fs.writeFile('/project/key.p8', 'local-private-key');
    const options = createOptions();
    options.env = { KEY_PATH: './key.p8' };
    const outputs = await prepareSubmissionAsync(options);
    expect(outputs.asc_app_identifier).toBe('123456');
    expect(outputs.groups).toBe('internal');
    expect(await fs.readJson(outputs.json_key_path!)).toEqual({
      key_id: 'ABC123',
      key: 'local-private-key',
    });
    expect(options.credentials.getAscKeyAsync).toHaveBeenCalledWith('com.example.override');
  });

  it.each([undefined, [], ['workflow-group']])(
    'preserves group precedence for %j',
    async groups => {
      await fs.writeJson('/project/eas.json', {
        submit: { production: { ios: { ascAppId: '123456', groups: ['profile-group'] } } },
      });
      const outputs = await prepareSubmissionAsync({ ...createOptions(), groups });
      expect(outputs.groups).toBe(groups?.length ? 'workflow-group' : 'profile-group');
    }
  );

  it('keeps the issuer for team keys', async () => {
    const options = createOptions();
    options.credentials.getAscKeyAsync.mockResolvedValue({ ...individualKey, issuer_id: 'issuer' });
    const outputs = await prepareSubmissionAsync(options);
    expect(await fs.readJson(outputs.json_key_path!)).toHaveProperty('issuer_id', 'issuer');
  });

  it('writes the Apple password to a private file, not a step output', async () => {
    const options = createOptions();
    options.env = {
      EXPO_APPLE_ID: 'apple@example.com',
      EXPO_APPLE_APP_SPECIFIC_PASSWORD: 'aaaa-bbbb-cccc-dddd',
    };
    const outputs = await prepareSubmissionAsync(options);
    expect(outputs.apple_id_username).toBe('apple@example.com');
    expect(outputs.json_key_path).toBeUndefined();
    expect(await fs.readFile(outputs.apple_app_specific_password_path!, 'utf8')).toBe(
      'aaaa-bbbb-cccc-dddd'
    );
    expect(JSON.stringify(outputs)).not.toContain('aaaa-bbbb-cccc-dddd');
  });

  it('does not fail submission when TestFlight setup fails', async () => {
    const options = createOptions();
    options.ensureTestFlightSetupAsync.mockRejectedValue(new Error('Apple unavailable'));
    await expect(prepareSubmissionAsync(options)).resolves.toHaveProperty('json_key_path');
  });

  it('falls back to production when the build profile has no submit profile', async () => {
    const options = createOptions();
    options.profileName = undefined;
    options.credentials.validateBuildAsync.mockResolvedValue('store-build');
    await expect(prepareSubmissionAsync(options)).resolves.toHaveProperty(
      'asc_app_identifier',
      '123456'
    );
  });

  it('fails for an explicitly missing profile', async () => {
    await expect(
      prepareSubmissionAsync({ ...createOptions(), profileName: 'missing' })
    ).rejects.toThrow('Missing submit profile');
  });

  it('requires ascAppId without evaluating app config or creating an ASC app', async () => {
    await fs.writeJson('/project/eas.json', { submit: { production: { ios: {} } } });
    await expect(prepareSubmissionAsync(createOptions())).rejects.toThrow('Set ascAppId');
  });

  it('fails when no stored submission key exists', async () => {
    const options = createOptions();
    options.credentials.getAscKeyAsync.mockResolvedValue(null);
    await expect(prepareSubmissionAsync(options)).rejects.toThrow(
      'Configure one with eas credentials'
    );
  });

  it('resolves Android release options and local credentials', async () => {
    await fs.writeJson('/project/eas.json', {
      submit: {
        production: {
          android: {
            serviceAccountKeyPath: './google.json',
            track: 'production',
            releaseStatus: 'inProgress',
            rollout: 0.2,
            changesNotSentForReview: true,
          },
        },
      },
    });
    await fs.writeFile('/project/google.json', googleKey);
    const options = createOptions();
    const outputs = await prepareSubmissionAsync({ ...options, platform: Platform.ANDROID });
    expect(outputs).toMatchObject({
      track: 'production',
      release_status: 'inProgress',
      rollout: '0.2',
      changes_not_sent_for_review: 'true',
    });
    expect(await fs.readFile(outputs.google_service_account_key_path!, 'utf8')).toBe(googleKey);
    expect(options.credentials.getGoogleKeyAsync).not.toHaveBeenCalled();
  });

  it('resolves stored Android credentials and default options', async () => {
    const options = createOptions();
    const outputs = await prepareSubmissionAsync({ ...options, platform: Platform.ANDROID });
    expect(outputs).toMatchObject({
      track: 'internal',
      release_status: 'completed',
      changes_not_sent_for_review: 'false',
    });
    expect(options.credentials.getGoogleKeyAsync).toHaveBeenCalledWith('com.example.artifact');
  });

  it('does not expose malformed credential contents in errors', async () => {
    const options = createOptions();
    options.credentials.getGoogleKeyAsync.mockResolvedValue('private-key-content');
    await expect(
      prepareSubmissionAsync({ ...options, platform: Platform.ANDROID })
    ).rejects.toThrow('service account key is invalid');
  });
});

function mockClient(responses: unknown[]) {
  const query = jest.fn();
  for (const data of responses) {
    query.mockReturnValueOnce({ toPromise: async () => ({ data }) });
  }
  return { query, client: { query } as unknown as Client };
}

describe(SubmissionCredentials, () => {
  it.each([
    { app: { id: 'other-project' }, platform: 'IOS' },
    { app: { id: appId }, platform: 'ANDROID' },
  ])('rejects a mismatched build before accessing credentials: %j', async build => {
    const { client, query } = mockClient([{ builds: { byId: build } }]);
    await expect(
      new SubmissionCredentials(client, appId).validateBuildAsync(buildId, Platform.IOS)
    ).rejects.toThrow('does not belong');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fetches only the selected iOS key secret', async () => {
    const { client, query } = mockClient([
      {
        app: {
          byId: {
            iosAppCredentials: [
              {
                appleAppIdentifier: { bundleIdentifier: 'other.app' },
                appStoreConnectApiKeyForSubmissions: { id: 'other-key' },
              },
              {
                appleAppIdentifier: { bundleIdentifier: 'com.example.artifact' },
                appStoreConnectApiKeyForSubmissions: { id: 'selected-key' },
              },
            ],
          },
        },
      },
      {
        appStoreConnectApiKey: {
          byId: { keyIdentifier: 'ABC123', keyP8: 'private-key', issuerIdentifier: null },
        },
      },
    ]);
    await expect(
      new SubmissionCredentials(client, appId).getAscKeyAsync('com.example.artifact')
    ).resolves.toEqual(individualKey);
    expect(query.mock.calls[1][1]).toEqual({ id: 'selected-key' });
  });
});

describe('submission worker functions', () => {
  it('removes partial credentials when preparation fails', async () => {
    const { client, query } = mockClient([]);
    query.mockReturnValue({
      toPromise: async () => ({ error: new CombinedError({ networkError: new Error('offline') }) }),
    });
    const context = createGlobalContextMock({
      projectTargetDirectory: '/project',
      staticContextContent: { job: { appId } },
    });
    const step = createPrepareSubmissionFunction({
      graphqlClient: client,
    } as CustomBuildContext).createBuildStepFromFunctionCall(context, {
      callInputs: {
        build_id: buildId,
        platform: 'ios',
        application_identifier: 'com.example.artifact',
        profile: 'production',
      },
    });
    await expect(step.executeAsync()).rejects.toThrow('Could not load the submission build');
    expect(await fs.pathExists(step.outputById.credentials_directory.value!)).toBe(false);
  });

  it('cleans credentials on success or failure and rejects unrelated paths', async () => {
    const context = createGlobalContextMock();
    const directory = `${context.stepsInternalBuildDirectory}/submissions/credentials-test`;
    await fs.ensureDir(directory);
    await fs.writeFile(`${directory}/key`, 'private-key');
    const fn = createCleanupSubmissionFunction();
    await fn
      .createBuildStepFromFunctionCall(context, {
        callInputs: { credentials_directory: directory },
      })
      .executeAsync();
    expect(await fs.pathExists(directory)).toBe(false);
    await expect(
      fn
        .createBuildStepFromFunctionCall(context, {
          callInputs: { credentials_directory: '/project' },
        })
        .executeAsync()
    ).rejects.toThrow('not created by prepare_submission');
    await fn
      .createBuildStepFromFunctionCall(context, { callInputs: { credentials_directory: '' } })
      .executeAsync();
    expect(await fs.pathExists('/project/eas.json')).toBe(true);
  });
});
