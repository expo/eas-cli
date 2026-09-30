import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { promptAsync } from '../../prompts';
import {
  assertValidDevDomainName,
  assignDevDomainNameAsync,
  getSignedDeploymentUrlAsync,
} from '../deployment';
import { DeploymentsMutation } from '../mutations';
import { DeploymentsQuery } from '../queries';

jest.mock('../mutations');
jest.mock('../queries');
jest.mock('../../prompts');
jest.mock('../../log');

function createDevDomainNameTakenError(): Error {
  return Object.assign(new Error('Dev domain name is already taken'), {
    graphQLErrors: [{ extensions: { errorCode: 'DEV_DOMAIN_NAME_TAKEN' } }],
  });
}

function createMissingDevDomainNameError(): Error {
  return Object.assign(new Error('App does not have a dev domain name'), {
    graphQLErrors: [{ extensions: { errorCode: 'APP_NO_DEV_DOMAIN_NAME' } }],
  });
}

describe(assertValidDevDomainName, () => {
  it.each(['abc', 'my-app', 'app123', 'my-app-123'])('accepts %p', name => {
    expect(() => {
      assertValidDevDomainName(name);
    }).not.toThrow();
  });

  it('rejects empty names', () => {
    expect(() => {
      assertValidDevDomainName('');
    }).toThrow(/choose a preview URL/);
  });

  it('rejects names shorter than 3 characters', () => {
    expect(() => {
      assertValidDevDomainName('ab');
    }).toThrow(/at least 3 characters/);
  });

  it('rejects names ending with a hyphen', () => {
    expect(() => {
      assertValidDevDomainName('my-app-');
    }).toThrow(/cannot end with a hyphen/);
  });

  it.each(['-my-app', 'My-App', 'my_app', 'my--app', 'my.app'])(
    'rejects names with invalid characters, like %p',
    name => {
      expect(() => {
        assertValidDevDomainName(name);
      }).toThrow(/lowercase letters, numbers, and non-consecutive hyphens/);
    }
  );
});

describe(assignDevDomainNameAsync, () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('assigns the requested dev domain name without prompting', async () => {
    const graphqlClient = {} as ExpoGraphqlClient;
    jest.mocked(DeploymentsMutation.assignDevDomainNameAsync).mockResolvedValueOnce(true);

    await assignDevDomainNameAsync({
      graphqlClient,
      appId: 'test-app-id',
      devDomainName: 'my-app',
      nonInteractive: true,
    });

    expect(DeploymentsMutation.assignDevDomainNameAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'test-app-id',
      name: 'my-app',
    });
    expect(DeploymentsQuery.getSuggestedDevDomainByAppIdAsync).not.toHaveBeenCalled();
    expect(promptAsync).not.toHaveBeenCalled();
  });

  it('throws when the requested dev domain name is taken', async () => {
    const graphqlClient = {} as ExpoGraphqlClient;
    jest
      .mocked(DeploymentsMutation.assignDevDomainNameAsync)
      .mockRejectedValueOnce(createDevDomainNameTakenError());

    await expect(
      assignDevDomainNameAsync({
        graphqlClient,
        appId: 'test-app-id',
        devDomainName: 'my-app',
        nonInteractive: true,
      })
    ).rejects.toThrow(/"my-app" is already taken.*--dev-domain/);

    expect(DeploymentsMutation.assignDevDomainNameAsync).toHaveBeenCalledTimes(1);
  });

  it('assigns the suggested dev domain name in non-interactive mode', async () => {
    const graphqlClient = {} as ExpoGraphqlClient;
    jest
      .mocked(DeploymentsQuery.getSuggestedDevDomainByAppIdAsync)
      .mockResolvedValueOnce('suggested-name');
    jest.mocked(DeploymentsMutation.assignDevDomainNameAsync).mockResolvedValueOnce(true);

    await assignDevDomainNameAsync({
      graphqlClient,
      appId: 'test-app-id',
      nonInteractive: true,
    });

    expect(DeploymentsMutation.assignDevDomainNameAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'test-app-id',
      name: 'suggested-name',
    });
    expect(promptAsync).not.toHaveBeenCalled();
  });

  it('falls back to the prompt when the requested dev domain name is taken in interactive mode', async () => {
    const graphqlClient = {} as ExpoGraphqlClient;
    jest
      .mocked(DeploymentsMutation.assignDevDomainNameAsync)
      .mockRejectedValueOnce(createDevDomainNameTakenError())
      .mockResolvedValueOnce(true);
    jest
      .mocked(DeploymentsQuery.getSuggestedDevDomainByAppIdAsync)
      .mockResolvedValueOnce('suggested-name');
    jest.mocked(promptAsync).mockResolvedValueOnce({ name: 'prompted-name' });

    await assignDevDomainNameAsync({
      graphqlClient,
      appId: 'test-app-id',
      devDomainName: 'my-app',
      nonInteractive: false,
    });

    expect(promptAsync).toHaveBeenCalledTimes(1);
    expect(DeploymentsMutation.assignDevDomainNameAsync).toHaveBeenLastCalledWith(graphqlClient, {
      appId: 'test-app-id',
      name: 'prompted-name',
    });
  });

  it('throws when the suggested dev domain name is taken in non-interactive mode', async () => {
    const graphqlClient = {} as ExpoGraphqlClient;
    jest
      .mocked(DeploymentsQuery.getSuggestedDevDomainByAppIdAsync)
      .mockResolvedValueOnce('suggested-name');
    jest
      .mocked(DeploymentsMutation.assignDevDomainNameAsync)
      .mockRejectedValueOnce(createDevDomainNameTakenError());

    await expect(
      assignDevDomainNameAsync({
        graphqlClient,
        appId: 'test-app-id',
        nonInteractive: true,
      })
    ).rejects.toThrow(/"suggested-name" is already taken.*--dev-domain/);

    expect(DeploymentsMutation.assignDevDomainNameAsync).toHaveBeenCalledTimes(1);
  });
});

describe(getSignedDeploymentUrlAsync, () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('throws when the requested dev domain name differs from the existing one', async () => {
    const graphqlClient = {} as ExpoGraphqlClient;
    jest.mocked(DeploymentsQuery.getDevDomainNameByAppIdAsync).mockResolvedValueOnce('other-name');

    await expect(
      getSignedDeploymentUrlAsync(graphqlClient, {
        appId: 'test-app-id',
        devDomainName: 'my-app',
        nonInteractive: true,
      })
    ).rejects.toThrow(/already set to "other-name\..*" and cannot be changed/);

    expect(DeploymentsMutation.createSignedDeploymentUrlAsync).not.toHaveBeenCalled();
  });

  it('returns the deployment URL when the requested dev domain name matches the existing one', async () => {
    const graphqlClient = {} as ExpoGraphqlClient;
    jest.mocked(DeploymentsQuery.getDevDomainNameByAppIdAsync).mockResolvedValueOnce('my-app');
    jest
      .mocked(DeploymentsMutation.createSignedDeploymentUrlAsync)
      .mockResolvedValueOnce('https://upload-url.example');

    await expect(
      getSignedDeploymentUrlAsync(graphqlClient, {
        appId: 'test-app-id',
        devDomainName: 'my-app',
        nonInteractive: true,
      })
    ).resolves.toBe('https://upload-url.example');
  });

  it('assigns the requested dev domain name when the project has none yet', async () => {
    const graphqlClient = {} as ExpoGraphqlClient;
    jest.mocked(DeploymentsQuery.getDevDomainNameByAppIdAsync).mockResolvedValueOnce(null);
    jest
      .mocked(DeploymentsMutation.createSignedDeploymentUrlAsync)
      .mockRejectedValueOnce(createMissingDevDomainNameError())
      .mockResolvedValueOnce('https://upload-url.example');
    jest.mocked(DeploymentsMutation.assignDevDomainNameAsync).mockResolvedValueOnce(true);

    await expect(
      getSignedDeploymentUrlAsync(graphqlClient, {
        appId: 'test-app-id',
        devDomainName: 'my-app',
        nonInteractive: true,
      })
    ).resolves.toBe('https://upload-url.example');

    expect(DeploymentsMutation.assignDevDomainNameAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'test-app-id',
      name: 'my-app',
    });
    // The retry after assignment must not re-run the dev domain pre-check query
    expect(DeploymentsQuery.getDevDomainNameByAppIdAsync).toHaveBeenCalledTimes(1);
    expect(promptAsync).not.toHaveBeenCalled();
  });

  it('throws when the requested dev domain name was never assigned by the deployment', async () => {
    const graphqlClient = {} as ExpoGraphqlClient;
    jest.mocked(DeploymentsQuery.getDevDomainNameByAppIdAsync).mockResolvedValueOnce(null);
    jest
      .mocked(DeploymentsMutation.createSignedDeploymentUrlAsync)
      .mockResolvedValueOnce('https://upload-url.example');

    await expect(
      getSignedDeploymentUrlAsync(graphqlClient, {
        appId: 'test-app-id',
        devDomainName: 'my-app',
        nonInteractive: true,
      })
    ).rejects.toThrow(/preview URL was not assigned as part of this deployment/);

    expect(DeploymentsMutation.assignDevDomainNameAsync).not.toHaveBeenCalled();
  });
});
