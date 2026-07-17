import { ArchiveSourceType } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { vol } from 'memfs';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { fetchAndCheckoutRefAsync } from '../../../common/git';
import { createCheckoutBuildFunction } from '../checkout';

jest.mock('../../../common/git');

const projectSourceDirectory = '/workingdir/source';
const projectTargetDirectory = '/workingdir/project';

const GIT_PROJECT_ARCHIVE = {
  type: ArchiveSourceType.GIT,
  repositoryUrl: 'https://x-access-token:1234567890@github.com/expo/app.git',
  gitRef: 'refs/heads/main',
  gitCommitHash: '0123456789abcdef0123456789abcdef01234567',
};

function createCheckoutStep({
  logger,
  callInputs = {},
  projectArchive,
}: {
  logger?: bunyan;
  callInputs?: Record<string, unknown>;
  projectArchive: Record<string, unknown>;
}): { globalCtx: ReturnType<typeof createGlobalContextMock>; executeAsync: () => Promise<void> } {
  const globalCtx = createGlobalContextMock({
    logger,
    projectSourceDirectory,
    projectTargetDirectory,
    staticContextContent: {
      job: { projectArchive },
    },
  });
  const buildStep = createCheckoutBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
    callInputs,
  });
  return { globalCtx, executeAsync: () => buildStep.executeAsync() };
}

describe(createCheckoutBuildFunction, () => {
  beforeEach(async () => {
    await vol.promises.mkdir(projectSourceDirectory, { recursive: true });
    await vol.promises.writeFile(`${projectSourceDirectory}/app.json`, '{}');
  });

  it('moves project sources to the target directory when no inputs are given', async () => {
    const { globalCtx, executeAsync } = createCheckoutStep({
      projectArchive: GIT_PROJECT_ARCHIVE,
    });

    await executeAsync();

    expect(await vol.promises.readFile(`${projectTargetDirectory}/app.json`, 'utf8')).toBe('{}');
    expect(globalCtx.wasCheckedOut()).toBe(true);
    expect(fetchAndCheckoutRefAsync).not.toHaveBeenCalled();
  });

  it('fetches and checks out the ref for git project sources', async () => {
    const { globalCtx, executeAsync } = createCheckoutStep({
      projectArchive: GIT_PROJECT_ARCHIVE,
      callInputs: { ref: 'feature/add-icon' },
    });

    await executeAsync();

    expect(fetchAndCheckoutRefAsync).toHaveBeenCalledWith({
      ref: 'feature/add-icon',
      repositoryDirectory: projectTargetDirectory,
    });
    expect(await vol.promises.readFile(`${projectTargetDirectory}/app.json`, 'utf8')).toBe('{}');
    expect(globalCtx.wasCheckedOut()).toBe(true);
  });

  it.each([
    [ArchiveSourceType.URL, { type: ArchiveSourceType.URL, url: 'https://example.com/app.tar.gz' }],
    [ArchiveSourceType.PATH, { type: ArchiveSourceType.PATH, path: '/artifacts/app.tar.gz' }],
    [ArchiveSourceType.NONE, { type: ArchiveSourceType.NONE }],
  ])('rejects the ref input for %s project sources', async (_type, projectArchive) => {
    const { globalCtx, executeAsync } = createCheckoutStep({
      projectArchive,
      callInputs: { ref: 'feature/add-icon' },
    });

    await expect(executeAsync()).rejects.toMatchObject({
      errorCode: 'EAS_CHECKOUT_REF_REQUIRES_GIT_SOURCES',
    });

    expect(await vol.promises.readFile(`${projectSourceDirectory}/app.json`, 'utf8')).toBe('{}');
    expect(vol.existsSync(`${projectTargetDirectory}/app.json`)).toBe(false);
    expect(globalCtx.wasCheckedOut()).toBe(false);
    expect(fetchAndCheckoutRefAsync).not.toHaveBeenCalled();
  });

  it('warns and skips the ref input when the project is already checked out', async () => {
    const logger = createMockLogger();
    jest.mocked(logger.child).mockReturnValue(logger);
    const { globalCtx, executeAsync } = createCheckoutStep({
      logger,
      projectArchive: GIT_PROJECT_ARCHIVE,
      callInputs: { ref: 'feature/add-icon' },
    });
    globalCtx.markAsCheckedOut(logger);

    await expect(executeAsync()).resolves.not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ignoring the "ref" input'));
    expect(await vol.promises.readFile(`${projectSourceDirectory}/app.json`, 'utf8')).toBe('{}');
    expect(vol.existsSync(`${projectTargetDirectory}/app.json`)).toBe(false);
    expect(fetchAndCheckoutRefAsync).not.toHaveBeenCalled();
  });
});
