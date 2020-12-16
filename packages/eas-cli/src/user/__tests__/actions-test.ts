import { Actor } from '../User';
import { ensureActorHasUsername, getActorDisplayName } from '../actions';

const userStub: Actor = {
  __typename: 'User',
  id: 'userId',
  username: 'username',
};

const robotStub: Actor = {
  __typename: 'Robot',
  id: 'userId',
  firstName: 'GLaDOS',
};

describe('getActorDisplayName', () => {
  it('returns anonymous for unauthenticated users', () => {
    expect(getActorDisplayName()).toBe('anonymous');
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

describe('ensureActorHasUsername', () => {
  it('returns username for user actors', () => {
    expect(ensureActorHasUsername(userStub)).toBe(userStub.username);
  });

  it('throws for robot actors', () => {
    expect(() => ensureActorHasUsername(robotStub)).toThrow('not supported for robot');
  });
});
