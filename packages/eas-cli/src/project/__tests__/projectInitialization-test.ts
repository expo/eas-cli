import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { saveProjectIdToAppConfigAsync } from '../../commandUtils/context/contextUtils/getProjectIdAsync';
import { jester } from '../../credentials/__tests__/fixtures-constants';
import { AppFragment } from '../../graphql/generated';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { confirmAsync } from '../../prompts';
import { createOrModifyExpoConfigAsync, getPrivateExpoConfigAsync } from '../expoConfig';
import {
  ensureOwnerSlugConsistencyAsync,
  linkExistingProjectByIdAsync,
} from '../projectInitialization';

jest.mock('../expoConfig');
jest.mock('../../commandUtils/context/contextUtils/getProjectIdAsync');
jest.mock('../../graphql/queries/AppQuery');
jest.mock('../../prompts');
jest.mock('../../ora', () => ({
  ora: () => ({
    start: () => ({ succeed: () => {}, fail: () => {} }),
  }),
}));

const PROJECT_DIR = '/test-project';
const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_PROJECT_ID = '00000000-0000-0000-0000-000000000002';

const app: AppFragment = {
  id: PROJECT_ID,
  name: 'testing-123',
  slug: 'testing-123',
  fullName: `@${jester.accounts[0].name}/testing-123`,
  ownerAccount: jester.accounts[0],
};

const graphqlClient = instance(mock<ExpoGraphqlClient>());

function mockExpoConfig(exp: { projectId?: string; owner?: string; slug?: string }): void {
  jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
    name: 'testing 123',
    slug: exp.slug as string,
    owner: exp.owner,
    extra: exp.projectId ? { eas: { projectId: exp.projectId } } : {},
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(AppQuery.byIdAsync).mockResolvedValue(app);
  jest.mocked(createOrModifyExpoConfigAsync).mockResolvedValue({
    type: 'success',
    config: { name: 'testing 123', slug: 'testing-123' } as any,
  });
});

describe(linkExistingProjectByIdAsync.name, () => {
  const options = { force: false, nonInteractive: true };

  it('rejects without writing anything when the project ID is unknown or inaccessible', async () => {
    jest.mocked(AppQuery.byIdAsync).mockRejectedValue(new Error('Entity not authorized.'));
    mockExpoConfig({ slug: 'testing-123' });

    await expect(
      linkExistingProjectByIdAsync(graphqlClient, PROJECT_ID, PROJECT_DIR, options)
    ).rejects.toThrow('No changes were made to your app config');

    expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
    expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
  });

  it('links an unlinked project and queries the server exactly once', async () => {
    mockExpoConfig({ owner: jester.accounts[0].name, slug: 'testing-123' });

    const result = await linkExistingProjectByIdAsync(
      graphqlClient,
      PROJECT_ID,
      PROJECT_DIR,
      options
    );

    expect(result).toMatchObject({
      projectId: PROJECT_ID,
      status: 'linked',
      owner: jester.accounts[0].name,
      slug: 'testing-123',
    });
    expect(saveProjectIdToAppConfigAsync).toHaveBeenCalledWith(PROJECT_DIR, PROJECT_ID);
    expect(AppQuery.byIdAsync).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when already linked to the same project', async () => {
    mockExpoConfig({
      projectId: PROJECT_ID,
      owner: jester.accounts[0].name,
      slug: 'testing-123',
    });

    const result = await linkExistingProjectByIdAsync(
      graphqlClient,
      PROJECT_ID,
      PROJECT_DIR,
      options
    );

    expect(result.status).toBe('already-linked');
    expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
  });

  it('rejects in non-interactive mode when linked to a different project without --force', async () => {
    mockExpoConfig({
      projectId: OTHER_PROJECT_ID,
      owner: jester.accounts[0].name,
      slug: 'testing-123',
    });

    await expect(
      linkExistingProjectByIdAsync(graphqlClient, PROJECT_ID, PROJECT_DIR, options)
    ).rejects.toThrow('Use --force flag to overwrite');

    expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
  });

  it('overwrites a different existing project link with force, without prompting', async () => {
    mockExpoConfig({
      projectId: OTHER_PROJECT_ID,
      owner: jester.accounts[0].name,
      slug: 'testing-123',
    });

    const result = await linkExistingProjectByIdAsync(graphqlClient, PROJECT_ID, PROJECT_DIR, {
      force: true,
      nonInteractive: true,
    });

    expect(result.status).toBe('linked');
    expect(saveProjectIdToAppConfigAsync).toHaveBeenCalledWith(PROJECT_DIR, PROJECT_ID);
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('prompts to overwrite a different existing project link in interactive mode', async () => {
    mockExpoConfig({
      projectId: OTHER_PROJECT_ID,
      owner: jester.accounts[0].name,
      slug: 'testing-123',
    });
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await expect(
      linkExistingProjectByIdAsync(graphqlClient, PROJECT_ID, PROJECT_DIR, {
        force: false,
        nonInteractive: false,
      })
    ).rejects.toThrow('Aborting');
    expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();

    jest.mocked(confirmAsync).mockResolvedValue(true);
    await linkExistingProjectByIdAsync(graphqlClient, PROJECT_ID, PROJECT_DIR, {
      force: false,
      nonInteractive: false,
    });
    expect(saveProjectIdToAppConfigAsync).toHaveBeenCalledWith(PROJECT_DIR, PROJECT_ID);
  });

  it('rejects on owner mismatch in non-interactive mode without --force', async () => {
    mockExpoConfig({ projectId: PROJECT_ID, owner: 'someone-else', slug: 'testing-123' });

    await expect(
      linkExistingProjectByIdAsync(graphqlClient, PROJECT_ID, PROJECT_DIR, options)
    ).rejects.toThrow('Use --force flag to overwrite');

    expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
  });

  it('rewrites a mismatched owner with force', async () => {
    mockExpoConfig({ projectId: PROJECT_ID, owner: 'someone-else', slug: 'testing-123' });

    await linkExistingProjectByIdAsync(graphqlClient, PROJECT_ID, PROJECT_DIR, {
      force: true,
      nonInteractive: true,
    });

    expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith(PROJECT_DIR, {
      owner: jester.accounts[0].name,
    });
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('fills in missing owner and slug without prompting', async () => {
    mockExpoConfig({ projectId: PROJECT_ID });

    await linkExistingProjectByIdAsync(graphqlClient, PROJECT_ID, PROJECT_DIR, options);

    expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith(PROJECT_DIR, {
      owner: jester.accounts[0].name,
    });
    expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith(PROJECT_DIR, {
      slug: 'testing-123',
    });
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('propagates dynamic config write failures', async () => {
    mockExpoConfig({ owner: jester.accounts[0].name, slug: 'testing-123' });
    jest
      .mocked(saveProjectIdToAppConfigAsync)
      .mockRejectedValue(new Error('Your project uses dynamic app configuration'));

    await expect(
      linkExistingProjectByIdAsync(graphqlClient, PROJECT_ID, PROJECT_DIR, options)
    ).rejects.toThrow('dynamic app configuration');
  });
});

describe(ensureOwnerSlugConsistencyAsync.name, () => {
  it('queries the server itself when no prefetched app is provided', async () => {
    jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
      name: 'testing 123',
      slug: 'testing-123',
      owner: jester.accounts[0].name,
    });

    const result = await ensureOwnerSlugConsistencyAsync(graphqlClient, PROJECT_ID, PROJECT_DIR, {
      force: false,
      nonInteractive: true,
    });

    expect(result).toEqual({ owner: jester.accounts[0].name, slug: 'testing-123' });
    expect(AppQuery.byIdAsync).toHaveBeenCalledTimes(1);
  });

  it('does not query the server when a prefetched app is provided', async () => {
    jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
      name: 'testing 123',
      slug: 'testing-123',
      owner: jester.accounts[0].name,
    });

    const result = await ensureOwnerSlugConsistencyAsync(graphqlClient, PROJECT_ID, PROJECT_DIR, {
      force: false,
      nonInteractive: true,
      prefetchedApp: app,
    });

    expect(result).toEqual({ owner: jester.accounts[0].name, slug: 'testing-123' });
    expect(AppQuery.byIdAsync).not.toHaveBeenCalled();
  });
});
