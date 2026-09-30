import { App, BetaGroup, User } from '@expo/apple-utils';

import { ensureTestFlightGroupExistsAsync } from '../ensureTestFlightGroup';
import { confirmAsync } from '../../../../prompts';

jest.mock('../../../../ora');
jest.mock('../../../../prompts', () => ({
  confirmAsync: jest.fn(),
}));
jest.mock('@expo/apple-utils', () => ({
  ...jest.requireActual('@expo/apple-utils'),
  User: { getAsync: jest.fn() },
  BetaGroup: { deleteAsync: jest.fn() },
}));

function mockApp({
  groups,
  createdGroup,
}: {
  groups: Partial<BetaGroup>[];
  createdGroup?: Partial<BetaGroup>;
}): App {
  return {
    id: '1234567890',
    context: {},
    getBetaGroupsAsync: jest.fn().mockResolvedValue(groups),
    createBetaGroupAsync: jest.fn().mockResolvedValue(createdGroup),
  } as unknown as App;
}

function mockGroup({
  hasAccessToAllBuilds,
}: {
  hasAccessToAllBuilds: boolean;
}): Partial<BetaGroup> {
  return {
    id: 'group-id',
    context: {} as BetaGroup['context'],
    attributes: {
      name: 'Team (Expo)',
      isInternalGroup: true,
      hasAccessToAllBuilds,
      betaTesters: [],
    } as unknown as BetaGroup['attributes'],
    createBulkBetaTesterAssignmentsAsync: jest.fn(),
  };
}

beforeEach(() => {
  jest.mocked(confirmAsync).mockReset();
  jest.mocked(User.getAsync).mockReset().mockResolvedValue([]);
  jest.mocked(BetaGroup.deleteAsync).mockReset();
});

describe(ensureTestFlightGroupExistsAsync, () => {
  it('skips setup when the app already has beta groups', async () => {
    const app = mockApp({ groups: [mockGroup({ hasAccessToAllBuilds: true })] });

    await ensureTestFlightGroupExistsAsync(app, { nonInteractive: true });

    expect(app.createBetaGroupAsync).not.toHaveBeenCalled();
    expect(User.getAsync).not.toHaveBeenCalled();
  });

  it('creates a group and adds admins without prompting in non-interactive mode', async () => {
    const app = mockApp({
      groups: [],
      createdGroup: mockGroup({ hasAccessToAllBuilds: true }),
    });

    await ensureTestFlightGroupExistsAsync(app, { nonInteractive: true });

    expect(app.createBetaGroupAsync).toHaveBeenCalledWith({
      name: 'Team (Expo)',
      isInternalGroup: true,
      hasAccessToAllBuilds: true,
    });
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('does not prompt or delete the group in non-interactive mode when it lacks access to all builds', async () => {
    const app = mockApp({
      groups: [],
      createdGroup: mockGroup({ hasAccessToAllBuilds: false }),
    });

    await ensureTestFlightGroupExistsAsync(app, { nonInteractive: true });

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(BetaGroup.deleteAsync).not.toHaveBeenCalled();
  });

  it('prompts to regenerate the group in interactive mode when it lacks access to all builds', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);
    const app = mockApp({
      groups: [],
      createdGroup: mockGroup({ hasAccessToAllBuilds: false }),
    });

    await ensureTestFlightGroupExistsAsync(app, { nonInteractive: false });

    expect(confirmAsync).toHaveBeenCalled();
    expect(BetaGroup.deleteAsync).not.toHaveBeenCalled();
  });
});
