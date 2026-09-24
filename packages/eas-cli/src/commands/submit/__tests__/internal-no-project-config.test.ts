import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import SubmitInternal from '../internal';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { createAnalyticsAsync } from '../../../analytics/AnalyticsManager';
import { createGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { findProjectDirAndVerifyProjectSetupAsync } from '../../../commandUtils/context/contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { jester, testProjectId } from '../../../credentials/__tests__/fixtures-constants';
import { getAndroidAppCredentialsWithCommonFieldsAsync } from '../../../credentials/android/api/GraphqlClient';
import { getIosAppCredentialsWithCommonFieldsAsync } from '../../../credentials/ios/api/GraphqlClient';
import { AppStoreConnectApiKeyQuery } from '../../../graphql/queries/AppStoreConnectApiKeyQuery';
import { GoogleServiceAccountKeyQuery } from '../../../graphql/queries/GoogleServiceAccountKeyQuery';
import { AppPlatform, BuildFragment } from '../../../graphql/generated';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { BuildQuery } from '../../../graphql/queries/BuildQuery';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { createSubmissionContextAsync } from '../../../submit/context';
import { ensureTestFlightSetupForExistingAppAsync } from '../../../submit/ios/ensureTestFlightSetup';
import SessionManager from '../../../user/SessionManager';
import { printJsonOnlyOutput } from '../../../utils/json';

jest.mock('../../../analytics/AnalyticsManager', () => ({
  ...jest.requireActual('../../../analytics/AnalyticsManager'),
  createAnalyticsAsync: jest.fn(),
}));
jest.mock('../../../commandUtils/context/contextUtils/createGraphqlClient');
jest.mock('../../../commandUtils/context/contextUtils/findProjectDirAndVerifyProjectSetupAsync');
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../graphql/queries/AppStoreConnectApiKeyQuery');
jest.mock('../../../graphql/queries/GoogleServiceAccountKeyQuery');
jest.mock('../../../credentials/android/api/GraphqlClient');
jest.mock('../../../credentials/ios/api/GraphqlClient');
jest.mock('../../../graphql/queries/BuildQuery');
jest.mock('../../../project/projectUtils');
jest.mock('../../../submit/ios/ensureTestFlightSetup');
jest.mock('../../../submit/context', () => ({
  ...jest.requireActual('../../../submit/context'),
  createSubmissionContextAsync: jest.fn(
    jest.requireActual('../../../submit/context').createSubmissionContextAsync
  ),
}));
jest.mock('../../../user/SessionManager');
jest.mock('../../../utils/json');
jest.mock('../../../log');
jest.mock('../../../ora');

const buildId = '11111111-1111-4111-8111-111111111111';
const applicationIdentifier = 'com.example.artifact';
const serviceAccount = {
  type: 'service_account',
  private_key: 'test-private-key',
  client_email: 'test@example.com',
};
let projectDir: string;

beforeEach(async () => {
  jest.clearAllMocks();
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'submit-no-dependencies-'));
  await fs.writeJson(path.join(projectDir, 'package.json'), { name: 'test-app' });
  await fs.writeFile(
    path.join(projectDir, 'app.config.js'),
    'throw new Error("App config must not load");'
  );
  await fs.writeFile(path.join(projectDir, 'key.p8'), 'test-p8');
  await fs.writeJson(path.join(projectDir, 'google.json'), serviceAccount);
  await fs.writeJson(path.join(projectDir, 'eas.json'), {
    submit: {
      base: {
        ios: {
          ascAppId: '123456789',
          ascApiKeyPath: path.join(projectDir, 'key.p8'),
          ascApiKeyId: 'KEY123',
        },
        android: { serviceAccountKeyPath: path.join(projectDir, 'google.json'), track: 'beta' },
      },
      production: { extends: 'base', ios: { groups: ['Internal'] } },
    },
  });
  jest.mocked(createGraphqlClient).mockReturnValue({} as any);
  jest.mocked(findProjectDirAndVerifyProjectSetupAsync).mockResolvedValue(projectDir);
  jest.mocked(createAnalyticsAsync).mockResolvedValue({ logEvent: jest.fn() } as any);
  jest
    .mocked(SessionManager.prototype.ensureLoggedInAsync)
    .mockResolvedValue({ actor: jester, authenticationInfo: { accessToken: 'test' } } as any);
  jest
    .mocked(AppQuery.byIdAsync)
    .mockResolvedValue({ id: testProjectId, name: 'Server name', slug: 'server-slug' } as any);
  jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue(jester.accounts[0]);
});

afterEach(async () => {
  await fs.remove(projectDir);
});

function command(platform: string, extraFlags: string[] = []): SubmitInternal {
  return new SubmitInternal(
    ['--platform', platform, '--id', buildId, '--profile', 'production', ...extraFlags],
    getMockOclifConfig()
  );
}

it.each([
  { platform: 'ios', stored: false },
  { platform: 'ios', stored: true },
  { platform: 'android', stored: false },
  { platform: 'android', stored: true },
])(
  'prepares $platform (stored credentials: $stored) without app config or node_modules',
  async ({ platform, stored }) => {
    if (stored) {
      const easJson = await fs.readJson(path.join(projectDir, 'eas.json'));
      delete easJson.submit.base.ios.ascApiKeyPath;
      delete easJson.submit.base.ios.ascApiKeyId;
      delete easJson.submit.base.android.serviceAccountKeyPath;
      await fs.writeJson(path.join(projectDir, 'eas.json'), easJson);
      jest.mocked(getIosAppCredentialsWithCommonFieldsAsync).mockResolvedValue({
        appleAppIdentifier: { bundleIdentifier: applicationIdentifier },
        appStoreConnectApiKeyForSubmissions: { id: 'asc-key', keyIdentifier: 'KEY123' },
      } as any);
      jest
        .mocked(AppStoreConnectApiKeyQuery.getByIdAsync)
        .mockResolvedValue({
          keyIdentifier: 'KEY123',
          keyP8: 'test-p8',
          issuerIdentifier: undefined,
        });
      jest.mocked(getAndroidAppCredentialsWithCommonFieldsAsync).mockResolvedValue({
        googleServiceAccountKeyForSubmissions: {
          id: 'google-key',
          clientEmail: serviceAccount.client_email,
        },
      } as any);
      jest
        .mocked(GoogleServiceAccountKeyQuery.getByIdAsync)
        .mockResolvedValue({ keyJson: JSON.stringify(serviceAccount) });
    }
    jest.mocked(BuildQuery.byIdAsync).mockResolvedValue({
      id: buildId,
      platform: platform === 'ios' ? AppPlatform.Ios : AppPlatform.Android,
      expirationDate: '2099-01-01T00:00:00Z',
      project: { id: testProjectId },
    } as unknown as BuildFragment);

    await command(platform, [
      '--project-id',
      testProjectId,
      '--application-identifier',
      applicationIdentifier,
    ]).run();

    expect(await fs.pathExists(path.join(projectDir, 'node_modules'))).toBe(false);
    expect(createSubmissionContextAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: testProjectId,
        applicationIdentifier,
        exp: { name: 'Server name', slug: 'server-slug' },
      })
    );
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      config: expect.objectContaining(
        platform === 'ios'
          ? {
              ascAppIdentifier: '123456789',
              ascApiJsonKey: JSON.stringify({ key_id: 'KEY123', key: 'test-p8' }),
              groups: ['Internal'],
            }
          : {
              track: 'beta',
              googleServiceAccountKeyJson: expect.any(String),
            }
      ),
    });
    if (stored) {
      const lookup =
        platform === 'ios'
          ? getIosAppCredentialsWithCommonFieldsAsync
          : getAndroidAppCredentialsWithCommonFieldsAsync;
      expect(lookup).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          projectName: 'server-slug',
          [platform === 'ios' ? 'bundleIdentifier' : 'androidApplicationIdentifier']:
            applicationIdentifier,
        })
      );
    }
    if (platform === 'ios') {
      expect(ensureTestFlightSetupForExistingAppAsync).toHaveBeenCalledWith(
        expect.objectContaining({ applicationIdentifierOverride: applicationIdentifier }),
        '123456789'
      );
    }
  }
);

it('keeps loading app config for callers without the new flags', async () => {
  await expect(command('ios').run()).rejects.toThrow('App config must not load');
  expect(AppQuery.byIdAsync).not.toHaveBeenCalled();
});

it.each([
  ['--project-id', testProjectId],
  ['--application-identifier', applicationIdentifier],
])('requires both identifiers when %s is passed', async (flag, value) => {
  await expect(command('ios', [flag, value]).run()).rejects.toThrow();
  expect(AppQuery.byIdAsync).not.toHaveBeenCalled();
  expect(createSubmissionContextAsync).not.toHaveBeenCalled();
});
