import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { SupabaseMutation } from '../../../../graphql/mutations/SupabaseMutation';
import { SupabaseQuery } from '../../../../graphql/queries/SupabaseQuery';
import { SupabaseProjectData } from '../../../../graphql/types/SupabaseConnection';
import Log from '../../../../log';
import { confirmAsync } from '../../../../prompts';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsSupabaseDisconnect from '../disconnect';

jest.mock('../../../../graphql/queries/SupabaseQuery');
jest.mock('../../../../graphql/mutations/SupabaseMutation');
jest.mock('../../../../prompts');
jest.mock('../../../../log');
jest.mock('../../../../utils/json');
jest.mock('../../../../ora', () => ({
  ora: jest.fn(),
}));

import { ora } from '../../../../ora';

function mockOraSpinner(): {
  start: jest.Mock;
  succeed: jest.Mock;
  fail: jest.Mock;
} {
  const spinner = {
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  };
  jest.mocked(ora).mockReturnValue(spinner as never);
  return spinner;
}

describe(IntegrationsSupabaseDisconnect, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  const mockProject: SupabaseProjectData = {
    id: 'project-1',
    supabaseProjectRef: 'abcdefghijklmnop',
    supabaseProjectName: 'Test App',
    supabaseProjectUrl: 'https://abcdefghijklmnop.supabase.co',
    supabaseRegion: 'us-east-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  function createCommand(argv: string[]): IntegrationsSupabaseDisconnect {
    const command = new IntegrationsSupabaseDisconnect(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: {
        projectId: testProjectId,
        exp: { slug: 'testapp' },
      },
      loggedIn: { graphqlClient },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    mockOraSpinner();
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.spyOn(Log, 'error').mockImplementation(() => {});
    jest.spyOn(Log, 'addNewLineIfNone').mockImplementation(() => {});
    jest.spyOn(Log, 'newLine').mockImplementation(() => {});
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(mockProject);
    jest.mocked(SupabaseMutation.deleteSupabaseProjectAsync).mockResolvedValue(mockProject.id);
    jest.mocked(confirmAsync).mockResolvedValue(true);
  });

  it('removes the project link after confirmation', async () => {
    await createCommand([]).runAsync();

    expect(SupabaseMutation.deleteSupabaseProjectAsync).toHaveBeenCalledWith(
      graphqlClient,
      mockProject.id
    );
  });

  it('skips confirmation with --yes', async () => {
    await createCommand(['--yes']).runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(SupabaseMutation.deleteSupabaseProjectAsync).toHaveBeenCalled();
  });

  it('cancels when confirmation is declined', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await createCommand([]).runAsync();

    expect(SupabaseMutation.deleteSupabaseProjectAsync).not.toHaveBeenCalled();
  });

  it('prints json when no project is linked', async () => {
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand(['--json']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith({ id: null });
  });

  it('warns when no project is linked', async () => {
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand([]).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('No Supabase project'));
    expect(SupabaseMutation.deleteSupabaseProjectAsync).not.toHaveBeenCalled();
  });

  it('prints json with id and ref on success', async () => {
    await createCommand(['--json', '--yes']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      id: mockProject.id,
      ref: mockProject.supabaseProjectRef,
    });
  });

  it('fails the spinner and rethrows when delete fails', async () => {
    jest
      .mocked(SupabaseMutation.deleteSupabaseProjectAsync)
      .mockRejectedValue(new Error('delete failed'));
    const spinner = mockOraSpinner();

    await expect(createCommand(['--yes']).runAsync()).rejects.toThrow('delete failed');
    expect(spinner.fail).toHaveBeenCalledWith('Failed to remove Supabase project link');
  });
});
