import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { DefaultEnvironment } from '../../../build/utils/environment';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import { confirmAsync } from '../../../prompts';
import { EAS_SUPABASE_ENVIRONMENTS, resolveTargetEnvironmentsAsync } from '../environments';

jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../prompts');

describe('resolveTargetEnvironmentsAsync', () => {
  const client = {} as ExpoGraphqlClient;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('falls back to the default EAS environments when none are known', async () => {
    expect(EAS_SUPABASE_ENVIRONMENTS).toEqual([
      DefaultEnvironment.Production,
      DefaultEnvironment.Preview,
      DefaultEnvironment.Development,
    ]);
    jest
      .mocked(EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync)
      .mockResolvedValue([]);

    await expect(
      resolveTargetEnvironmentsAsync(client, 'app-1', ['preview'], true)
    ).resolves.toEqual(['preview']);
  });

  it('names Supabase when interactive confirmation is declined', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync)
      .mockResolvedValue(['production']);
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await expect(
      resolveTargetEnvironmentsAsync(client, 'app-1', ['preview'], false)
    ).rejects.toThrow('Canceled. No additional Supabase project was provisioned.');
  });
});
