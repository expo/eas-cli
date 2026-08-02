import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { runBuildAndSubmitAsync } from '../../../build/runBuildAndSubmit';
import { linkExistingProjectByIdAsync } from '../../../project/projectInitialization';
import Build from '../index';

jest.mock('fs-extra', () => ({
  pathExists: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../build/runBuildAndSubmit', () => ({
  runBuildAndSubmitAsync: jest.fn(),
}));
jest.mock('../../../project/projectInitialization', () => ({
  linkExistingProjectByIdAsync: jest.fn(),
}));
jest.mock('../../../utils/statuspageService', () => ({
  maybeWarnAboutEasOutagesAsync: jest.fn(),
}));
jest.mock('../../../utils/json');
jest.mock('../../../log');

const VALID_UUID = '58b3e612-4d49-4de6-9dd4-0e5db1e0e6b4';

describe(Build, () => {
  const mockConfig = getMockOclifConfig();
  const graphqlClient = {};

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(runBuildAndSubmitAsync).mockResolvedValue({ buildIds: [], buildProfiles: [] });
    jest.mocked(linkExistingProjectByIdAsync).mockResolvedValue({
      projectId: VALID_UUID,
      status: 'linked',
      owner: 'jester',
      slug: 'testing-123',
    });
  });

  function createCommand(argv: string[]): Build {
    const command = new Build(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockResolvedValue({
      loggedIn: {
        actor: {},
        graphqlClient,
      },
      getDynamicPrivateProjectConfigAsync: jest.fn(),
      projectDir: '/project',
      analytics: {},
      vcsClient: {},
    } as any);
    return command;
  }

  it('links the project before starting the build when --link-project-id is passed', async () => {
    await createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--link-project-id',
      VALID_UUID,
    ]).runAsync();

    expect(linkExistingProjectByIdAsync).toHaveBeenCalledWith(graphqlClient, VALID_UUID, '/project', {
      force: false,
      nonInteractive: true,
    });
    const linkOrder = jest.mocked(linkExistingProjectByIdAsync).mock.invocationCallOrder[0];
    const buildOrder = jest.mocked(runBuildAndSubmitAsync).mock.invocationCallOrder[0];
    expect(linkOrder).toBeLessThan(buildOrder);
  });

  it('passes force: true when --force is set', async () => {
    await createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--link-project-id',
      VALID_UUID,
      '--force',
    ]).runAsync();

    expect(linkExistingProjectByIdAsync).toHaveBeenCalledWith(graphqlClient, VALID_UUID, '/project', {
      force: true,
      nonInteractive: true,
    });
  });

  it('does not link when the flag is not passed', async () => {
    await createCommand(['--platform', 'ios', '--non-interactive']).runAsync();

    expect(linkExistingProjectByIdAsync).not.toHaveBeenCalled();
    expect(runBuildAndSubmitAsync).toHaveBeenCalled();
  });

  it('rejects --force without --link-project-id', async () => {
    await expect(
      createCommand(['--platform', 'ios', '--non-interactive', '--force']).runAsync()
    ).rejects.toThrow(/link-project-id/);

    expect(runBuildAndSubmitAsync).not.toHaveBeenCalled();
  });

  it('rejects a --link-project-id value that is not a UUID', async () => {
    await expect(
      createCommand([
        '--platform',
        'ios',
        '--non-interactive',
        '--link-project-id',
        'not-a-uuid',
      ]).runAsync()
    ).rejects.toThrow('must be a valid UUID');

    expect(linkExistingProjectByIdAsync).not.toHaveBeenCalled();
    expect(runBuildAndSubmitAsync).not.toHaveBeenCalled();
  });

  it('does not start a build when linking fails', async () => {
    jest
      .mocked(linkExistingProjectByIdAsync)
      .mockRejectedValue(new Error('Failed to link project'));

    await expect(
      createCommand([
        '--platform',
        'ios',
        '--non-interactive',
        '--link-project-id',
        VALID_UUID,
      ]).runAsync()
    ).rejects.toThrow('Failed to link project');

    expect(runBuildAndSubmitAsync).not.toHaveBeenCalled();
  });

  it('works with --json', async () => {
    await createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--json',
      '--link-project-id',
      VALID_UUID,
    ]).runAsync();

    expect(linkExistingProjectByIdAsync).toHaveBeenCalled();
    expect(runBuildAndSubmitAsync).toHaveBeenCalled();
  });
});
