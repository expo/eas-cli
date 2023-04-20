import { Platform } from '@expo/eas-build-job';
import { ArchiveSource, ArchiveSourceType, Workflow } from '@expo/eas-build-job/dist/common';
import { CredentialsSource } from '@expo/eas-json';
import { mock } from 'ts-mockito';

import { BuildContext } from '../../context';
import { prepareJobAsync } from '../prepareJob';

function getBuildContextMock(): BuildContext<Platform.IOS> {
  const ctxMock = mock<BuildContext<Platform.IOS>>();
  ctxMock.projectDir = '.';
  ctxMock.workflow = Workflow.GENERIC;
  ctxMock.clearCache = false;
  return ctxMock;
}

describe('prepareJobAsync called', () => {
  const jobData = {
    projectArchive: { type: ArchiveSourceType.NONE } as ArchiveSource,
    buildScheme: 'test build scheme',
  };
  it('uses default cache values with paths when settings not provided', async () => {
    const ctxMock = getBuildContextMock();
    const result = await prepareJobAsync(ctxMock, jobData);
    expect(result?.cache).toBeDefined();
    expect(result.cache.paths).toBeDefined();
    expect(result.cache.paths).toEqual([]);
    expect(result.cache.customPaths).toBeUndefined();
  });
  it('uses default paths when settings provided without either paths or customPaths', async () => {
    const ctxMock = getBuildContextMock();
    ctxMock.buildProfile = {
      // @ts-ignore
      cache: {
        disabled: false,
      },
      credentialsSource: CredentialsSource.LOCAL,
      distribution: 'internal',
    };
    const result = await prepareJobAsync(ctxMock, jobData);
    expect(result?.cache).toBeDefined();
    expect(result.cache.paths).toBeDefined();
    expect(result.cache.paths).toEqual([]);
    expect(result.cache.customPaths).toBeUndefined();
  });
  it('uses paths when paths provided', async () => {
    const ctxMock = getBuildContextMock();
    ctxMock.buildProfile = {
      cache: {
        disabled: false,
        paths: ['index.ts'],
      },
      credentialsSource: CredentialsSource.LOCAL,
      distribution: 'internal',
    };
    const result = await prepareJobAsync(ctxMock, jobData);
    expect(result?.cache).toBeDefined();
    expect(result.cache.paths).toBeDefined();
    expect(result.cache.paths).toEqual(['index.ts']);
    expect(result.cache.customPaths).toBeUndefined();
  });
  it('uses deprecated customPaths as paths when customPaths provided', async () => {
    const ctxMock = getBuildContextMock();
    ctxMock.buildProfile = {
      // @ts-ignore
      cache: {
        disabled: false,
        customPaths: ['index.ts'],
      },
      credentialsSource: CredentialsSource.LOCAL,
      distribution: 'internal',
    };
    const result = await prepareJobAsync(ctxMock, jobData);
    expect(result?.cache).toBeDefined();
    expect(result.cache.paths).toBeDefined();
    expect(result.cache.paths).toEqual(['index.ts']);
    expect(result.cache.customPaths).toBeUndefined();
  });
});
