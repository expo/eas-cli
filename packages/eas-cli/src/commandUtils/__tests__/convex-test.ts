import dateFormat from 'dateformat';

import {
  confirmRecentConvexInviteAsync,
  formatConvexProject,
  formatConvexTeam,
  formatConvexTeamConnection,
  getConvexProjectDashboardUrl,
  getConvexTeamDashboardUrl,
} from '../convex';
import {
  ConvexProjectData,
  ConvexTeamConnectionData,
} from '../../graphql/types/ConvexTeamConnection';
import Log from '../../log';
import { confirmAsync } from '../../prompts';

jest.mock('../../log');
jest.mock('../../prompts');

describe('Convex command utilities', () => {
  const mockConnection: ConvexTeamConnectionData = {
    id: 'connection-1',
    convexTeamIdentifier: 'team-123',
    convexTeamName: 'Test Team',
    convexTeamSlug: 'test team',
    hasBeenClaimed: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    invitedAt: '2024-01-02T00:00:00.000Z',
    invitedEmail: 'user@example.com',
  };

  const mockProject: ConvexProjectData = {
    id: 'convex-project-1',
    convexProjectIdentifier: 'project-123',
    convexProjectName: 'Test Project',
    convexProjectSlug: 'test project',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    convexTeamConnection: mockConnection,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.mocked(confirmAsync).mockResolvedValue(true);
  });

  it('builds encoded Convex dashboard URLs', () => {
    expect(getConvexTeamDashboardUrl(mockConnection)).toBe(
      'https://dashboard.convex.dev/t/test%20team'
    );
    expect(getConvexProjectDashboardUrl(mockProject)).toBe(
      'https://dashboard.convex.dev/t/test%20team/test%20project'
    );
  });

  it('formats team and project metadata with invite details', () => {
    expect(formatConvexTeam(mockConnection)).toBe('Test Team / test team');
    expect(formatConvexTeamConnection(mockConnection)).toContain('Test Team / test team');
    expect(formatConvexTeamConnection(mockConnection)).not.toContain('team-123');
    expect(formatConvexTeamConnection(mockConnection)).not.toContain('connection-1');
    expect(formatConvexTeamConnection(mockConnection)).toContain('Claimed');
    expect(formatConvexTeamConnection(mockConnection)).toContain('Yes');
    expect(formatConvexTeamConnection(mockConnection)).toContain('user@example.com');
    expect(formatConvexTeamConnection(mockConnection)).toContain(
      dateFormat(mockConnection.invitedAt, 'mmm dd HH:MM:ss')
    );
    expect(formatConvexProject(mockProject)).toContain('project-123');
    expect(formatConvexProject(mockProject)).not.toContain('convex-project-1');
    expect(formatConvexProject(mockProject)).toContain('Test Team / test team');
    expect(formatConvexProject(mockProject)).not.toContain('team-123');
  });

  it('does not prompt when the previous invite timestamp is invalid', async () => {
    await expect(
      confirmRecentConvexInviteAsync(
        { ...mockConnection, invitedAt: 'not-a-date' },
        { nonInteractive: false }
      )
    ).resolves.toBe(true);

    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('does not prompt when the previous invite is old', async () => {
    await expect(
      confirmRecentConvexInviteAsync(
        {
          ...mockConnection,
          invitedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        },
        { nonInteractive: false }
      )
    ).resolves.toBe(true);

    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('prompts before resending a recent invite in interactive mode', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);
    const recentInviteTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    await expect(
      confirmRecentConvexInviteAsync(
        {
          ...mockConnection,
          invitedAt: recentInviteTimestamp,
        },
        { nonInteractive: false }
      )
    ).resolves.toBe(false);

    expect(confirmAsync).toHaveBeenCalledWith({
      message: expect.stringContaining('Are you sure you want to send another invite?'),
    });
    expect(confirmAsync).toHaveBeenCalledWith({
      message: expect.stringContaining(dateFormat(recentInviteTimestamp, 'mmm dd HH:MM:ss')),
    });
  });

  it('warns and proceeds for recent invites in non-interactive mode', async () => {
    await expect(
      confirmRecentConvexInviteAsync(
        {
          ...mockConnection,
          invitedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        },
        { nonInteractive: true }
      )
    ).resolves.toBe(true);

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('non-interactive mode'));
  });
});
