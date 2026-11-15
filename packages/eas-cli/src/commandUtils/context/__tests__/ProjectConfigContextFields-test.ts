import { ExpoConfig } from '@expo/config';
import { anything, instance, mock, when } from 'ts-mockito';

import { getPrivateExpoConfigAsync, getPublicExpoConfigAsync } from '../../../project/expoConfig';
import SessionManager from '../../../user/SessionManager';
import { ContextOptions } from '../ContextField';
import {
  DynamicPrivateProjectConfigContextField,
  DynamicPublicProjectConfigContextField,
} from '../DynamicProjectConfigContextField';
import { OptionalPrivateProjectConfigContextField } from '../OptionalPrivateProjectConfigContextField';
import { PrivateProjectConfigContextField } from '../PrivateProjectConfigContextField';
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

type LoadConfigAsync = (
  options: ContextOptions
) => Promise<{ exp: ExpoConfig; projectId: string } | undefined>;

const fields: [string, LoadConfigAsync, typeof getPrivateExpoConfigAsync][] = [
  [
    DynamicPublicProjectConfigContextField.name,
    async options =>
      await (
        await new DynamicPublicProjectConfigContextField().getValueAsync(options)
      )(),
    getPublicExpoConfigAsync,
  ],
  [
    DynamicPrivateProjectConfigContextField.name,
    async options =>
      await (
        await new DynamicPrivateProjectConfigContextField().getValueAsync(options)
      )(),
    getPrivateExpoConfigAsync,
  ],
  [
    PrivateProjectConfigContextField.name,
    async options => await new PrivateProjectConfigContextField().getValueAsync(options),
    getPrivateExpoConfigAsync,
  ],
  [
    OptionalPrivateProjectConfigContextField.name,
    async options => await new OptionalPrivateProjectConfigContextField().getValueAsync(options),
    getPrivateExpoConfigAsync,
  ],
];

function createContextOptions(withServerSideEnvironment: string | null): ContextOptions {
  const sessionManager = mock<SessionManager>();
  when(sessionManager.ensureLoggedInAsync(anything())).thenResolve({
    authenticationInfo: { accessToken: null, sessionSecret: null },
  } as any);
  return {
    nonInteractive: true,
    sessionManager: instance(sessionManager),
    withServerSideEnvironment,
  } as ContextOptions;
}

describe.each(fields)('%s', (_name, loadConfigAsync, getExpoConfigAsync) => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(findProjectDirAndVerifyProjectSetupAsync).mockResolvedValue('/app');
    jest.mocked(getProjectIdAsync).mockResolvedValue(projectId);
  });

  it('reads the app config once when the project ID is in it', async () => {
    jest.mocked(getExpoConfigAsync).mockResolvedValue(linkedExp);

    const result = await loadConfigAsync(createContextOptions(null));

    expect(result).toMatchObject({ exp: linkedExp, projectId });
    expect(getExpoConfigAsync).toHaveBeenCalledTimes(1);
  });

  it('reads the app config again after the project ID is written to it', async () => {
    jest
      .mocked(getExpoConfigAsync)
      .mockResolvedValueOnce(unlinkedExp)
      .mockResolvedValueOnce(linkedExp);

    const result = await loadConfigAsync(createContextOptions(null));

    expect(result?.exp).toBe(linkedExp);
    expect(getExpoConfigAsync).toHaveBeenCalledTimes(2);
  });

  it('reads the app config again with server-side environment variables', async () => {
    jest.mocked(getExpoConfigAsync).mockResolvedValue(linkedExp);
    jest.mocked(loadServerSideEnvironmentVariablesAsync).mockResolvedValue({ B: '2' });

    await loadConfigAsync(createContextOptions('production'));

    expect(getExpoConfigAsync).toHaveBeenCalledTimes(2);
    expect(getExpoConfigAsync).toHaveBeenLastCalledWith('/app', { env: { B: '2' } });
  });

  it('reads the app config again when the server-side environment is empty', async () => {
    jest.mocked(getExpoConfigAsync).mockResolvedValue(linkedExp);
    jest.mocked(loadServerSideEnvironmentVariablesAsync).mockResolvedValue({});

    await loadConfigAsync(createContextOptions('production'));

    expect(getExpoConfigAsync).toHaveBeenCalledTimes(2);
  });
});

describe(DynamicPrivateProjectConfigContextField, () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(findProjectDirAndVerifyProjectSetupAsync).mockResolvedValue('/app');
    jest.mocked(getProjectIdAsync).mockResolvedValue(projectId);
  });

  it('merges server-side environment variables into the env passed in', async () => {
    jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue(linkedExp);
    jest.mocked(loadServerSideEnvironmentVariablesAsync).mockResolvedValue({ B: '2' });

    const getConfigAsync = await new DynamicPrivateProjectConfigContextField().getValueAsync(
      createContextOptions('production')
    );
    await getConfigAsync({ env: { A: '1' } });

    expect(getPrivateExpoConfigAsync).toHaveBeenNthCalledWith(1, '/app', { env: { A: '1' } });
    expect(getPrivateExpoConfigAsync).toHaveBeenNthCalledWith(2, '/app', {
      env: { A: '1', B: '2' },
    });
  });
});
