import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import { confirmAsync } from '../../prompts';
import { DEFAULT_ENVIRONMENTS } from '../defaults';
import { parseEnvironmentFlag, resolveTargetEnvironmentsAsync } from '../resolve';

jest.mock('../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../prompts');

describe('parseEnvironmentFlag', () => {
  it('returns null when undefined', () => {
    expect(parseEnvironmentFlag(undefined)).toBeNull();
  });

  it('throws on empty or whitespace-only values', () => {
    expect(() => parseEnvironmentFlag('')).toThrow(/Pass at least one EAS environment/);
    expect(() => parseEnvironmentFlag('   ')).toThrow(/Pass at least one EAS environment/);
    expect(() => parseEnvironmentFlag(',,,')).toThrow(/Pass at least one EAS environment/);
  });

  it('dedupes and normalizes values', () => {
    expect(parseEnvironmentFlag(' Preview ,production, preview ')).toEqual([
      'preview',
      'production',
    ]);
  });

  it('throws on invalid environment names', () => {
    expect(() => parseEnvironmentFlag('ab')).toThrow(/Invalid EAS environment/);
    expect(() => parseEnvironmentFlag('Bad Env')).toThrow(/Invalid EAS environment/);
  });
});

describe('resolveTargetEnvironmentsAsync', () => {
  const client = {} as ExpoGraphqlClient;
  const options = { defaultEnvironments: DEFAULT_ENVIRONMENTS, label: 'Example' };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('wraps environments query failures in a generic error that keeps the cause', async () => {
    const cause = new Error('network down');
    jest
      .mocked(EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync)
      .mockRejectedValue(cause);

    await expect(
      resolveTargetEnvironmentsAsync(client, 'app-1', ['preview'], true, options)
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/Failed to fetch available environments/),
        cause,
      })
    );
  });

  it('keeps non-Error query failures as the cause', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync)
      .mockRejectedValue('network down');

    await expect(
      resolveTargetEnvironmentsAsync(client, 'app-1', ['preview'], true, options)
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/Failed to fetch available environments/),
        cause: 'network down',
      })
    );
  });

  it('falls back to default environments when none are known', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync)
      .mockResolvedValue([]);

    await expect(
      resolveTargetEnvironmentsAsync(client, 'app-1', ['preview'], true, options)
    ).resolves.toEqual(['preview']);
  });

  it('returns requested environments when all are known', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync)
      .mockResolvedValue(['production', 'preview']);

    await expect(
      resolveTargetEnvironmentsAsync(client, 'app-1', ['preview'], true, options)
    ).resolves.toEqual(['preview']);
  });

  it('throws in non-interactive mode for unknown default environments', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync)
      .mockResolvedValue(['production']);

    await expect(
      resolveTargetEnvironmentsAsync(client, 'app-1', ['preview'], true, options)
    ).rejects.toThrow(/EAS environment\(s\) not found/);
  });

  it('throws in non-interactive mode for unknown custom environments', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync)
      .mockResolvedValue(['production']);

    await expect(
      resolveTargetEnvironmentsAsync(client, 'app-1', ['staging'], true, options)
    ).rejects.toThrow(/Custom environments require an Enterprise plan/);
  });

  it('confirms unknown environments interactively', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync)
      .mockResolvedValue(['production']);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await expect(
      resolveTargetEnvironmentsAsync(client, 'app-1', ['preview', 'development'], false, options)
    ).resolves.toEqual(['preview', 'development']);
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('environments') })
    );
  });

  it('cancels when interactive confirmation is declined', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync)
      .mockResolvedValue(['production']);
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await expect(
      resolveTargetEnvironmentsAsync(client, 'app-1', ['preview'], false, options)
    ).rejects.toThrow(/Canceled\. No additional Example project was provisioned\./);
  });

  it('mentions enterprise plan for custom environments interactively', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync)
      .mockResolvedValue(DEFAULT_ENVIRONMENTS);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await resolveTargetEnvironmentsAsync(client, 'app-1', ['enterprise-env'], false, options);
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Custom environments require an Enterprise plan'),
      })
    );
  });
});
