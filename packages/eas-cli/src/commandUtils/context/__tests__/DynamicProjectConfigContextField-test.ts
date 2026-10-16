import { ExpoConfig } from '@expo/config';
import { anything, instance, mock, when } from 'ts-mockito';

import { getPrivateExpoConfigAsync } from '../../../project/expoConfig';
import SessionManager from '../../../user/SessionManager';
import { ContextOptions } from '../ContextField';
import { DynamicPrivateProjectConfigContextField } from '../DynamicProjectConfigContextField';
import { findProjectDirAndVerifyProjectSetupAsync } from '../contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from '../contextUtils/getProjectIdAsync';
import { loadServerSideEnvironmentVariablesAsync } from '../contextUtils/loadServerSideEnvironmentVariablesAsync';

jest.mock('../../../project/expoConfig');
jest.mock('../contextUtils/findProjectDirAndVerifyProjectSetupAsync');
jest.mock('../contextUtils/getProjectIdAsync', () => ({
  ...jest.requireActual('../contextUtils/getProjectIdAsync'),
  getProjectIdAsync: jest.fn(),
}));
jest.mock('../contextUtils/loadServerSideEnvironmentVariablesAsync');
jest.mock('../contextUtils/createGraphqlClient');

const projectId = 'test-project-id';
const linkedExp = { name: 'a', slug: 'a', extra: { eas: { projectId } } } as ExpoConfig;
const unlinkedExp = { name: 'a', slug: 'a' } as ExpoConfig;

async function getConfigFnAsync(
  withServerSideEnvironment: string | null
): ReturnType<DynamicPrivateProjectConfigContextField['getValueAsync']> {
  const sessionManager = mock<SessionManager>();
  when(sessionManager.ensureLoggedInAsync(anything())).thenResolve({
    authenticationInfo: { accessToken: null, sessionSecret: null },
  } as any);
  return await new DynamicPrivateProjectConfigContextField().getValueAsync({
    nonInteractive: true,
    sessionManager: instance(sessionManager),
    withServerSideEnvironment,
  } as ContextOptions);
}

describe(DynamicPrivateProjectConfigContextField, () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(findProjectDirAndVerifyProjectSetupAsync).mockResolvedValue('/app');
    jest.mocked(getProjectIdAsync).mockResolvedValue(projectId);
  });

  it('reads the app config once when the project ID is in it', async () => {
    jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue(linkedExp);

    const getConfigAsync = await getConfigFnAsync(null);
    const result = await getConfigAsync({ env: { A: '1' } });

    expect(result).toEqual({ exp: linkedExp, projectDir: '/app', projectId });
    expect(getPrivateExpoConfigAsync).toHaveBeenCalledTimes(1);
    expect(getPrivateExpoConfigAsync).toHaveBeenCalledWith('/app', { env: { A: '1' } });
  });

  it('reads the app config again after the project ID is written to it', async () => {
    jest
      .mocked(getPrivateExpoConfigAsync)
      .mockResolvedValueOnce(unlinkedExp)
      .mockResolvedValueOnce(linkedExp);

    const getConfigAsync = await getConfigFnAsync(null);
    const result = await getConfigAsync();

    expect(result.exp).toBe(linkedExp);
    expect(getPrivateExpoConfigAsync).toHaveBeenCalledTimes(2);
  });

  it('reads the app config again with server-side environment variables', async () => {
    jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue(linkedExp);
    jest.mocked(loadServerSideEnvironmentVariablesAsync).mockResolvedValue({ B: '2' });

    const getConfigAsync = await getConfigFnAsync('production');
    await getConfigAsync({ env: { A: '1' } });

    expect(getPrivateExpoConfigAsync).toHaveBeenCalledTimes(2);
    expect(getPrivateExpoConfigAsync).toHaveBeenLastCalledWith('/app', {
      env: { A: '1', B: '2' },
    });
  });
});
