import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { NpmrcAuthTokenLine } from '../../../templates/npmrc';
import { createSetUpNpmrcBuildFunction } from '../useNpmToken';

jest.mock('fs');
jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));

const projectTargetDirectory = '/workingdir/project';
const homeDirectory = '/home/expo';

describe(createSetUpNpmrcBuildFunction, () => {
  beforeEach(async () => {
    vol.reset();
    await vol.promises.mkdir(projectTargetDirectory, { recursive: true });
    await vol.promises.mkdir(homeDirectory, { recursive: true });
    jest.mocked(spawn).mockResolvedValue({ stdout: `${homeDirectory}/.npmrc\n` } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('adds the NPM_TOKEN placeholder from the step env to ~/.npmrc on EAS Build', async () => {
    const globalCtx = createGlobalContextMock({ projectTargetDirectory });
    globalCtx.updateEnv({ NPM_TOKEN: 'npm_secret_token', EAS_BUILD_RUNNER: 'eas-build' });
    const step = createSetUpNpmrcBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {},
    });

    await step.executeAsync();

    expect(await vol.promises.readFile(`${homeDirectory}/.npmrc`, 'utf8')).toContain(
      NpmrcAuthTokenLine
    );
  });
});
