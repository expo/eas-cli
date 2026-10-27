import { getMockViewerUserPermission } from '../../__tests__/viewerUserPermission';
import { Permission, Role } from '../../graphql/generated';
import { Actor } from '../../user/User';
import { getAccountChoices } from '../accountSelection';

const userActor: Actor = {
  __typename: 'User',
  id: 'user-id',
  email: 'jane@example.com',
  username: 'jane',
  accounts: [
    {
      id: 'account-id-org',
      name: 'acme',
      ownerUserActor: null,
      viewerUserPermission2: getMockViewerUserPermission(Role.ViewOnly),
    },
    {
      id: 'account-id-personal',
      name: 'jane',
      ownerUserActor: { id: 'user-id' },
      viewerUserPermission2: getMockViewerUserPermission(Role.Owner),
    },
    {
      id: 'account-id-team',
      name: 'bob',
      ownerUserActor: { id: 'other-user-id' },
      viewerUserPermission2: getMockViewerUserPermission(Role.Admin),
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
      viewerUserPermission2: getMockViewerUserPermission(Role.Admin),
    },
    {
      id: 'account-id-2',
      name: 'other-org',
      viewerUserPermission2: getMockViewerUserPermission(Role.ViewOnly),
    },
  ],
  isExpoAdmin: false,
  featureGates: {},
} as any;

describe(getAccountChoices, () => {
  it('lists the personal account first and annotates account types for users', () => {
    const choices = getAccountChoices(userActor);

    expect(choices.map(choice => choice.title)).toEqual(['jane', 'bob', 'acme']);
    expect(choices[0].description).toEqual('(Personal)');
    expect(choices[1].description).toEqual('(Team)');
    expect(choices[0].disabled).toBeUndefined();
    expect(choices[2].description).toEqual('(Organization)');
    expect(choices[2]).toMatchObject({
      disabled: true,
      disabledReason:
        'You do not have the required permissions to create projects on the "acme" account.',
    });
  });

  it('disables the personal account when the user cannot create apps on it', () => {
    const viewerOnlyActor = {
      ...userActor,
      accounts: [
        {
          id: 'account-id-personal',
          name: 'jane',
          ownerUserActor: { id: 'user-id' },
          viewerUserPermission2: getMockViewerUserPermission(Role.ViewOnly),
        },
      ],
    } as any as Actor;

    const choices = getAccountChoices(viewerOnlyActor);

    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({
      description: '(Personal)',
      disabled: true,
      disabledReason:
        'You do not have the required permissions to create projects on the "jane" account.',
    });
  });

  it('explains when the credential scopes prevent creating apps on an account', () => {
    const scopedActor = {
      ...userActor,
      accounts: [
        {
          id: 'account-id-personal',
          name: 'jane',
          ownerUserActor: { id: 'user-id' },
          viewerUserPermission2: {
            ...getMockViewerUserPermission(Role.Owner),
            effectivePermissions: [Permission.View],
          },
        },
      ],
    } as any as Actor;

    expect(getAccountChoices(scopedActor)[0]).toMatchObject({
      disabled: true,
      disabledReason:
        'The permissions granted during authentication do not allow you to create projects on the "jane" account. Run eas login to change the permission grant.',
    });
  });

  it('lists accounts without personal/team/organization annotations for robots', () => {
    const choices = getAccountChoices(robotActor);

    expect(choices.map(choice => choice.title)).toEqual(['acme', 'other-org']);
    expect(choices[0]).not.toHaveProperty('disabled');
    expect(choices[1]).toMatchObject({
      disabled: true,
      disabledReason:
        'You do not have the required permissions to create projects on the "other-org" account.',
    });
  });
});
