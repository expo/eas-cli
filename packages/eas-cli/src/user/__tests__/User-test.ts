import { getMockViewerUserPermission } from '../../__tests__/viewerUserPermission';
import { Permission, Role } from '../../graphql/generated';
import {
  Actor,
  getActorDisplayName,
  getCannotCreateProjectsOnAccountNameReason,
  getCreatableAccountNames,
  getPersonalAccount,
} from '../User';

const userStub: Actor = {
  __typename: 'User',
  id: 'userId',
  email: 'user@example.com',
  username: 'username',
  accounts: [
    {
      id: 'account_id_777',
      name: 'username',
      viewerUserPermission2: getMockViewerUserPermission(Role.Owner),
    },
  ],
  isExpoAdmin: false,
  featureGates: {},
};

const ssoUserStub: Actor = {
  __typename: 'SSOUser',
  id: 'ssoUserId',
  username: 'ssoUsername',
  accounts: [
    {
      id: 'account_id_888',
      name: 'ssoUsername',
      viewerUserPermission2: getMockViewerUserPermission(Role.Owner),
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

describe(getCannotCreateProjectsOnAccountNameReason, () => {
  const actor: Actor = {
    ...userStub,
    accounts: [
      {
        id: 'account_id_1',
        name: 'developer-org',
        viewerUserPermission2: getMockViewerUserPermission(Role.Developer),
      },
      {
        id: 'account_id_2',
        name: 'viewer-org',
        viewerUserPermission2: getMockViewerUserPermission(Role.ViewOnly),
      },
      {
        id: 'account_id_3',
        name: 'scoped-org',
        viewerUserPermission2: {
          ...getMockViewerUserPermission(Role.Admin),
          effectivePermissions: [Permission.View],
        },
      },
    ],
  };

  it('returns null when the actor can create projects on the account', () => {
    expect(getCannotCreateProjectsOnAccountNameReason(actor, 'developer-org')).toBeNull();
  });

  it('explains a role without the PUBLISH permission', () => {
    expect(getCannotCreateProjectsOnAccountNameReason(actor, 'viewer-org')).toBe(
      'You do not have the required permissions to create projects on the "viewer-org" account.'
    );
  });

  it('explains when the credential scopes remove the PUBLISH permission', () => {
    expect(getCannotCreateProjectsOnAccountNameReason(actor, 'scoped-org')).toBe(
      'The permissions granted during authentication do not allow you to create projects on the "scoped-org" account. Run eas login to change the permission grant.'
    );
  });

  it('explains when the actor has no access to the account', () => {
    expect(getCannotCreateProjectsOnAccountNameReason(actor, 'unknown-org')).toBe(
      'You do not have access to the "unknown-org" account.'
    );
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
          viewerUserPermission2: getMockViewerUserPermission(Role.Owner),
        },
        {
          id: 'account_id_2',
          name: 'other-user-team',
          ownerUserActor: { id: 'otherUserId', username: 'other-user' },
          viewerUserPermission2: getMockViewerUserPermission(Role.Admin),
        },
        {
          id: 'account_id_3',
          name: 'view-only-org',
          viewerUserPermission2: getMockViewerUserPermission(Role.ViewOnly),
        },
        {
          id: 'account_id_4',
          name: 'username',
          ownerUserActor: { id: 'userId', username: 'username' },
          viewerUserPermission2: getMockViewerUserPermission(Role.Owner),
        },
      ],
    };

    expect(getCreatableAccountNames(actor)).toEqual(['username', 'other-user-team', 'some-org']);
  });

  it('excludes accounts without the PUBLISH permission, including when the credential scopes remove it', () => {
    const actor: Actor = {
      ...userStub,
      accounts: [
        {
          id: 'account_id_1',
          name: 'developer-org',
          viewerUserPermission2: getMockViewerUserPermission(Role.Developer),
        },
        {
          id: 'account_id_2',
          name: 'runner-org',
          viewerUserPermission2: getMockViewerUserPermission(Role.Runner),
        },
        {
          id: 'account_id_3',
          name: 'custom-org',
          viewerUserPermission2: {
            permissions: [Permission.Admin, Permission.View],
            effectivePermissions: [Permission.Admin, Permission.View],
          },
        },
        {
          id: 'account_id_4',
          name: 'username',
          ownerUserActor: { id: 'userId', username: 'username' },
          viewerUserPermission2: {
            ...getMockViewerUserPermission(Role.Owner),
            effectivePermissions: [Permission.View],
          },
        },
      ],
    };

    expect(getCreatableAccountNames(actor)).toEqual(['developer-org']);
  });
});

describe('getPersonalAccount', () => {
  const personalAccount = {
    id: 'personal_account_id',
    name: 'renamed-personal',
    ownerUserActor: { id: 'userId', username: 'username' },
    viewerUserPermission2: getMockViewerUserPermission(Role.Owner),
  };

  it('returns the account owned by the user, even when its name differs from the username', () => {
    const actor: Actor = {
      ...userStub,
      accounts: [
        {
          id: 'org_account_id',
          name: 'username',
          viewerUserPermission2: getMockViewerUserPermission(Role.Owner),
        },
        personalAccount,
      ],
    };

    expect(getPersonalAccount(actor)).toBe(personalAccount);
  });

  it('returns the account owned by an SSO user', () => {
    const actor: Actor = {
      ...ssoUserStub,
      accounts: [
        {
          ...personalAccount,
          ownerUserActor: { id: 'ssoUserId', username: 'ssoUsername' },
        },
      ],
    };

    expect(getPersonalAccount(actor)?.id).toBe('personal_account_id');
  });

  it('does not return a team account owned by another user', () => {
    const actor: Actor = {
      ...userStub,
      accounts: [
        {
          ...personalAccount,
          ownerUserActor: { id: 'otherUserId', username: 'other-user' },
        },
      ],
    };

    expect(getPersonalAccount(actor)).toBeNull();
  });

  it('returns null when the personal account is not in the accounts list (e.g. scoped session)', () => {
    expect(getPersonalAccount({ ...userStub, accounts: [] })).toBeNull();
  });

  it('returns the primary account of a partner actor', () => {
    const partnerAccount = {
      id: 'partner_account_id',
      name: 'partner-account',
      viewerUserPermission2: getMockViewerUserPermission(Role.Owner),
    };
    const actor: Actor = {
      __typename: 'PartnerActor',
      id: 'partnerActorId',
      username: 'partner-user',
      primaryAccount: { id: 'partner_account_id' },
      accounts: [partnerAccount],
      isExpoAdmin: false,
      featureGates: {},
    };

    expect(getPersonalAccount(actor)).toBe(partnerAccount);
  });

  it('returns null for robots and missing actors', () => {
    expect(getPersonalAccount(robotStub)).toBeNull();
    expect(getPersonalAccount()).toBeNull();
  });
});
