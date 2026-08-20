import { Role } from '../../graphql/generated';
import { Actor, getActorDisplayName, getCreatableAccountNames } from '../User';

const userStub: Actor = {
  __typename: 'User',
  id: 'userId',
  email: 'user@example.com',
  username: 'username',
  primaryAccount: {
    id: 'account_id_777',
    name: 'username',
    viewerUserPermission: { role: Role.Owner },
  },
  accounts: [
    {
      id: 'account_id_777',
      name: 'username',
      viewerUserPermission: { role: Role.Owner },
    },
  ],
  isExpoAdmin: false,
  featureGates: {},
};

const ssoUserStub: Actor = {
  __typename: 'SSOUser',
  id: 'ssoUserId',
  username: 'ssoUsername',
  primaryAccount: {
    id: 'account_id_888',
    name: 'ssoUsername',
    viewerUserPermission: { role: Role.Owner },
  },
  accounts: [
    {
      id: 'account_id_888',
      name: 'ssoUsername',
      viewerUserPermission: { role: Role.Owner },
    },
  ],
  isExpoAdmin: false,
  featureGates: {},
};

const robotStub: Actor = {
  __typename: 'Robot',
  id: 'userId',
  firstName: 'GLaDOS',
  accounts: [],
  isExpoAdmin: false,
  featureGates: {},
};

describe('getActorDisplayName', () => {
  it('returns unknown for users that are null (deleted) or not recorded', () => {
    expect(getActorDisplayName()).toBe('unknown');
  });

  it('returns username for regular user actors', () => {
    expect(getActorDisplayName(userStub)).toBe(userStub.username);
  });

  it('returns username for SSO user actors', () => {
    expect(getActorDisplayName(ssoUserStub)).toBe(`${ssoUserStub.username}`);
  });

  it('returns firstName with robot prefix for robot actors', () => {
    expect(getActorDisplayName(robotStub)).toBe(`${robotStub.firstName} (robot)`);
  });

  it('returns robot prefix only for robot actors without firstName', () => {
    expect(getActorDisplayName({ ...robotStub, firstName: undefined })).toBe('robot');
  });
});

describe('getCreatableAccountNames', () => {
  it('lists the personal account first, then team accounts, then organizations, excluding view-only accounts', () => {
    const actor: Actor = {
      ...userStub,
      accounts: [
        {
          id: 'account_id_1',
          name: 'some-org',
          viewerUserPermission: { role: Role.Owner },
        },
        {
          id: 'account_id_2',
          name: 'other-user-team',
          ownerUserActor: { id: 'otherUserId', username: 'other-user' },
          viewerUserPermission: { role: Role.Admin },
        },
        {
          id: 'account_id_3',
          name: 'view-only-org',
          viewerUserPermission: { role: Role.ViewOnly },
        },
        {
          id: 'account_id_4',
          name: 'username',
          ownerUserActor: { id: 'userId', username: 'username' },
          viewerUserPermission: { role: Role.Owner },
        },
      ],
    };

    expect(getCreatableAccountNames(actor)).toEqual(['username', 'other-user-team', 'some-org']);
  });
});
