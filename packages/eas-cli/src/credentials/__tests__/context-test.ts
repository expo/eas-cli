import { CredentialsContext } from '../context';
import { authenticateAsync } from '../ios/appstore/authenticate';
import Log from '../../log';
import { confirmAsync } from '../../prompts';

jest.mock('../../prompts');
jest.mock('../../log');
jest.mock('../ios/appstore/authenticate');

function createContext(): CredentialsContext {
  return new CredentialsContext({
    projectInfo: null,
    nonInteractive: false,
    projectDir: '.',
    user: { __typename: 'User', username: 'quin', accounts: [] } as any,
    graphqlClient: {} as any,
    analytics: {} as any,
    vcsClient: {} as any,
  });
}

describe(CredentialsContext.prototype.bestEffortAppStoreAuthenticateAsync, () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(authenticateAsync).mockResolvedValue({ team: { id: 'TEAM' } } as any);
  });

  it('authenticates without further explanation when the offer is accepted', async () => {
    jest.mocked(confirmAsync).mockResolvedValueOnce(true);
    const ctx = createContext();

    await ctx.bestEffortAppStoreAuthenticateAsync();

    expect(authenticateAsync).toHaveBeenCalledTimes(1);
    expect(Log.warn).not.toHaveBeenCalled();
  });

  it('says why a later step needs the login that was declined', async () => {
    // Repros expo/eas-cli#4422: declining prints "we will ask you again about it", and the next
    // step that needs Apple access then goes straight to the Apple ID prompt with no reason
    // given, which reads as the decline having been ignored.
    jest.mocked(confirmAsync).mockResolvedValueOnce(false);
    const ctx = createContext();

    await ctx.bestEffortAppStoreAuthenticateAsync();
    expect(authenticateAsync).not.toHaveBeenCalled();
    expect(Log.warn).not.toHaveBeenCalled();

    // A later step that cannot run without Apple access, e.g. listing distribution certificates.
    await ctx.appStore.ensureAuthenticatedAsync();

    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('the login you skipped is needed after all')
    );
    expect(authenticateAsync).toHaveBeenCalledTimes(1);
  });

  it('explains once, not before every later call', async () => {
    jest.mocked(confirmAsync).mockResolvedValueOnce(false);
    const ctx = createContext();
    await ctx.bestEffortAppStoreAuthenticateAsync();

    await ctx.appStore.ensureAuthenticatedAsync();
    ctx.appStore.authCtx = undefined; // a later step re-authenticates, e.g. after a mode switch
    await ctx.appStore.ensureAuthenticatedAsync();

    expect(Log.warn).toHaveBeenCalledTimes(1);
  });

  it('does not prompt or explain in non-interactive mode', async () => {
    const ctx = new CredentialsContext({
      projectInfo: null,
      nonInteractive: true,
      projectDir: '.',
      user: { __typename: 'User', username: 'quin', accounts: [] } as any,
      graphqlClient: {} as any,
      analytics: {} as any,
      vcsClient: {} as any,
    });

    await ctx.bestEffortAppStoreAuthenticateAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(Log.warn).not.toHaveBeenCalled();
  });
});
