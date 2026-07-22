import { Role } from '../../graphql/generated';
import { Actor, getActorDisplayName, getCreatableAccountNamesNewestFirst } from '../User';

const userStub: Actor = {
  __typename: 'User',
  id: 'userId',
  email: 'user@example.com',
  username: 'username',
  primaryAccount: {
    id: 'account_id_777',
    name: 'username',
    users: [{ role: Role.Owner, actor: { id: 'userId' } }],
  },
  accounts: [
    {
      id: 'account_id_777',
      name: 'username',
      createdAt: '2020-01-01T00:00:00.000Z',
      users: [{ role: Role.Owner, actor: { id: 'userId' } }],
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
    users: [{ role: Role.Owner, actor: { id: 'ssoUserId' } }],
  },
  accounts: [
    {
      id: 'account_id_888',
      name: 'ssoUsername',
      createdAt: '2020-01-01T00:00:00.000Z',
      users: [{ role: Role.Owner, actor: { id: 'ssoUserId' } }],
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

describe('getCreatableAccountNamesNewestFirst', () => {
  it('sorts accounts by creation date from newest to oldest and excludes view-only accounts', () => {
    const actor: Actor = {
      ...userStub,
      accounts: [
        {
          id: 'account_id_1',
          name: 'oldest',
          createdAt: '2019-01-01T00:00:00.000Z',
          users: [{ role: Role.Owner, actor: { id: 'userId' } }],
        },
        {
          id: 'account_id_2',
          name: 'newest',
          createdAt: '2023-01-01T00:00:00.000Z',
          users: [{ role: Role.Admin, actor: { id: 'userId' } }],
        },
        {
          id: 'account_id_3',
          name: 'view-only',
          createdAt: '2024-01-01T00:00:00.000Z',
          users: [{ role: Role.ViewOnly, actor: { id: 'userId' } }],
        },
        {
          id: 'account_id_4',
          name: 'middle',
          createdAt: '2021-01-01T00:00:00.000Z',
          users: [{ role: Role.Owner, actor: { id: 'userId' } }],
        },
      ],
    };

    expect(getCreatableAccountNamesNewestFirst(actor)).toEqual(['newest', 'middle', 'oldest']);
  });
});
