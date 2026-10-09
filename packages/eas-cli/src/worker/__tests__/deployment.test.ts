import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { promptAsync } from '../../prompts';
import {
  assertValidDevDomainName,
  assignDevDomainNameAsync,
  assignWorkerDeploymentAliasAsync,
  assignWorkerDeploymentProductionAsync,
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

function createAliasResult({
  aliasName,
  deploymentIdentifier,
}: {
  aliasName: string | null;
  deploymentIdentifier: string;
}): any {
  return {
    id: 'alias-id',
    aliasName,
    url: 'https://warp-nexus.expo.app',
    workerDeployment: {
      id: 'worker-deployment-id',
      url: `https://warp-nexus--${deploymentIdentifier}.expo.app`,
      deploymentIdentifier,
      deploymentDomain: 'warp-nexus',
      createdAt: '2026-09-11T00:00:00.000Z',
    },
  };
}

describe(assignWorkerDeploymentProductionAsync, () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns the alias when production was moved to the requested deployment', async () => {
    const graphqlClient = {} as ExpoGraphqlClient;
    const alias = createAliasResult({ aliasName: null, deploymentIdentifier: 'y3iw49p3qz' });
    jest.mocked(DeploymentsMutation.assignAliasAsync).mockResolvedValueOnce(alias);

    await expect(
      assignWorkerDeploymentProductionAsync({
        graphqlClient,
        appId: 'test-app-id',
        deploymentId: 'y3iw49p3qz',
      })
    ).resolves.toBe(alias);
  });

  it('throws when production still points at the previous deployment', async () => {
    // Repros expo/eas-cli#4388: the mutation resolves, so the command printed
    // "Promoted deployment to production" and exited 0 while production kept
    // serving the previous bundle.
    const graphqlClient = {} as ExpoGraphqlClient;
    jest
      .mocked(DeploymentsMutation.assignAliasAsync)
      .mockResolvedValueOnce(
        createAliasResult({ aliasName: null, deploymentIdentifier: 'c0547b2ed2' })
      );

    await expect(
      assignWorkerDeploymentProductionAsync({
        graphqlClient,
        appId: 'test-app-id',
        deploymentId: 'y3iw49p3qz',
      })
    ).rejects.toThrow(
      'Production was not moved to deployment "y3iw49p3qz" and still points to "c0547b2ed2".'
    );
  });
});

describe(assignWorkerDeploymentAliasAsync, () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns the alias when it was moved to the requested deployment', async () => {
    const graphqlClient = {} as ExpoGraphqlClient;
    const alias = createAliasResult({ aliasName: 'staging', deploymentIdentifier: 'y3iw49p3qz' });
    jest.mocked(DeploymentsMutation.assignAliasAsync).mockResolvedValueOnce(alias);

    await expect(
      assignWorkerDeploymentAliasAsync({
        graphqlClient,
        appId: 'test-app-id',
        deploymentId: 'y3iw49p3qz',
        aliasName: 'staging',
      })
    ).resolves.toBe(alias);
  });

  it('names the alias when it still points at the previous deployment', async () => {
    const graphqlClient = {} as ExpoGraphqlClient;
    jest
      .mocked(DeploymentsMutation.assignAliasAsync)
      .mockResolvedValueOnce(
        createAliasResult({ aliasName: 'staging', deploymentIdentifier: 'c0547b2ed2' })
      );

    await expect(
      assignWorkerDeploymentAliasAsync({
        graphqlClient,
        appId: 'test-app-id',
        deploymentId: 'y3iw49p3qz',
        aliasName: 'staging',
      })
    ).rejects.toThrow('Alias "staging" was not moved to deployment "y3iw49p3qz"');
  });
});
