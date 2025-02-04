import { AppVersionSource, EasJsonAccessor } from '@expo/eas-json';
import fs from 'fs-extra';
import { vol } from 'memfs';

import { easCliVersion } from '../../utils/easCli';
import GitClient from '../../vcs/clients/git';
import { Client } from '../../vcs/vcs';
import { ensureProjectConfiguredAsync } from '../configure';

jest.mock('fs');
jest.mock('../../vcs/vcs');
jest.mock('../../vcs/clients/git');

beforeEach(async () => {
  vol.reset();
});

describe(ensureProjectConfiguredAsync, () => {
  it('returns false and does not configure if eas.json exists', async () => {
    vol.fromJSON({
      './eas.json': JSON.stringify({
        cli: {
          version: `>= ${easCliVersion}`,
        },
        build: {
          development: {
            developmentClient: true,
            distribution: 'internal',
          },
          preview: {
            distribution: 'internal',
          },
          production: {},
        },
        submit: {
          production: {},
        },
      }),
    });
    await expect(fs.pathExists(EasJsonAccessor.formatEasJsonPath('.'))).resolves.toBeTruthy();
    const vcsClientMock = jest.mocked(new GitClient({ requireCommit: false }));
    vcsClientMock.showChangedFilesAsync.mockImplementation(async () => {});
    vcsClientMock.isCommitRequiredAsync.mockImplementation(async () => false);
    vcsClientMock.trackFileAsync.mockImplementation(async () => {});
    const result = await ensureProjectConfiguredAsync({
      projectDir: '.',
      nonInteractive: false,
      vcsClient: vcsClientMock as unknown as Client,
    });
    expect(result).toBeFalsy();
    await expect(fs.pathExists(EasJsonAccessor.formatEasJsonPath('.'))).resolves.toBeTruthy();
  });
  it('returns true and configures if eas.json does not exist', async () => {
    const writeFileMock = jest.spyOn(fs, 'writeFile');
    writeFileMock.mockImplementation(async (...args) => {
      const easJsonPath = args[0] as string;
      const easJsonData = args[1] as string;
      vol.fromJSON({
        [easJsonPath]: easJsonData,
      });
    });
    await expect(fs.pathExists(EasJsonAccessor.formatEasJsonPath('.'))).resolves.toBeFalsy();
    const vcsClientMock = jest.mocked(new GitClient({ requireCommit: false }));
    vcsClientMock.showChangedFilesAsync.mockImplementation(async () => {});
    vcsClientMock.isCommitRequiredAsync.mockImplementation(async () => false);
    vcsClientMock.trackFileAsync.mockImplementation(async () => {});
    const result = await ensureProjectConfiguredAsync({
      projectDir: '.',
      nonInteractive: false,
      vcsClient: vcsClientMock as unknown as Client,
    });
    expect(result).toBeTruthy();
    await expect(fs.pathExists(EasJsonAccessor.formatEasJsonPath('.'))).resolves.toBeTruthy();
    const easJson = await EasJsonAccessor.fromProjectPath('.').readAsync();
    expect(easJson.cli?.appVersionSource).toEqual(AppVersionSource.REMOTE);
  });
});
