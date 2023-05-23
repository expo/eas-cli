import { Role } from '../../graphql/generated';
import { Actor, getActorDisplayName } from '../User';

const userStub: Actor = {
  __typename: 'User',
  id: 'userId',
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
      users: [{ role: Role.Owner, actor: { id: 'userId' } }],
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

  it('returns username for user actors', () => {
    expect(getActorDisplayName(userStub)).toBe(userStub.username);
  });

  it('returns firstName with robot prefix for robot actors', () => {
    expect(getActorDisplayName(robotStub)).toBe(`${robotStub.firstName} (robot)`);
  });

  it('returns robot prefix only for robot actors without firstName', () => {
    expect(getActorDisplayName({ ...robotStub, firstName: undefined })).toBe('robot');
  });
});
