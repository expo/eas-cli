import { Role } from '../../graphql/generated';
import { Actor } from '../../user/User';
import {
  getAccountChoices,
  getAccountNamesWhereUserHasSufficientPermissionsToCreateApp,
} from '../accountSelection';

const userActor: Actor = {
  __typename: 'User',
  id: 'user-id',
  email: 'jane@example.com',
  username: 'jane',
  primaryAccount: {
    id: 'account-id-personal',
    name: 'jane',
    users: [{ role: Role.Owner, actor: { id: 'user-id' } }],
  },
  accounts: [
    {
      id: 'account-id-org',
      name: 'acme',
      createdAt: '2022-06-15T00:00:00.000Z',
      ownerUserActor: null,
      users: [{ role: Role.ViewOnly, actor: { id: 'user-id' } }],
    },
    {
      id: 'account-id-personal',
      name: 'jane',
      createdAt: '2020-01-01T00:00:00.000Z',
      ownerUserActor: { id: 'user-id' },
      users: [{ role: Role.Owner, actor: { id: 'user-id' } }],
    },
    {
      id: 'account-id-team',
      name: 'bob',
      createdAt: '2024-03-01T00:00:00.000Z',
      ownerUserActor: { id: 'other-user-id' },
      users: [{ role: Role.Admin, actor: { id: 'user-id' } }],
    },
  ],
  isExpoAdmin: false,
  featureGates: {},
} as any;

const robotActor: Actor = {
  __typename: 'Robot',
  id: 'robot-id',
  accounts: [
    {
      id: 'account-id-1',
      name: 'acme',
      createdAt: '2021-01-01T00:00:00.000Z',
      users: [{ role: Role.Admin, actor: { id: 'robot-id' } }],
    },
    {
      id: 'account-id-2',
      name: 'other-org',
      createdAt: '2023-01-01T00:00:00.000Z',
      users: [{ role: Role.ViewOnly, actor: { id: 'robot-id' } }],
    },
  ],
  isExpoAdmin: false,
  featureGates: {},
} as any;

describe(getAccountNamesWhereUserHasSufficientPermissionsToCreateApp, () => {
  it('excludes accounts where the actor has the view-only role', () => {
    expect(getAccountNamesWhereUserHasSufficientPermissionsToCreateApp(userActor)).toEqual(
      new Set(['jane', 'bob'])
    );
  });
});

describe(getAccountChoices, () => {
  it('lists accounts from newest to oldest and annotates account types for users', () => {
    const choices = getAccountChoices(
      userActor,
      getAccountNamesWhereUserHasSufficientPermissionsToCreateApp(userActor)
    );

    expect(choices.map(choice => choice.title)).toEqual(['bob', 'acme', 'jane']);
    expect(choices[0].description).toEqual('(Team)');
    expect(choices[1].description).toEqual('(Organization) (Viewer Role)');
    expect(choices[2].description).toEqual('(Personal)');
  });

  it('annotates viewer role on the personal account when the user cannot create apps on it', () => {
    const viewerOnlyActor = {
      ...userActor,
      accounts: [
        {
          id: 'account-id-personal',
          name: 'jane',
          ownerUserActor: { id: 'user-id' },
          users: [{ role: Role.ViewOnly, actor: { id: 'user-id' } }],
        },
      ],
    } as any as Actor;

    const choices = getAccountChoices(
      viewerOnlyActor,
      getAccountNamesWhereUserHasSufficientPermissionsToCreateApp(viewerOnlyActor)
    );

    expect(choices).toHaveLength(1);
    expect(choices[0].description).toEqual('(Personal) (Viewer Role)');
  });

  it('lists accounts from newest to oldest without personal/team/organization annotations for robots', () => {
    const choices = getAccountChoices(
      robotActor,
      getAccountNamesWhereUserHasSufficientPermissionsToCreateApp(robotActor)
    );

    expect(choices.map(choice => choice.title)).toEqual(['other-org', 'acme']);
    expect(choices[0].description).toEqual('(Viewer Role)');
    expect(choices[1].description).toBeUndefined();
  });
});
