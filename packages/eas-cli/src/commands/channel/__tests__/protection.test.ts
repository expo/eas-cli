import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import {
  protectUpdateChannelAsync,
  unprotectUpdateChannelAsync,
} from '../../../channel/protection';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { ChannelQuery } from '../../../graphql/queries/ChannelQuery';
import Log from '../../../log';
import { toggleConfirmAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ChannelProtect from '../protect';
import ChannelUnprotect from '../unprotect';

jest.mock('../../../channel/protection');
jest.mock('../../../graphql/queries/ChannelQuery');
jest.mock('../../../log');
jest.mock('../../../prompts');
jest.mock('../../../utils/json');

const graphqlClient = {} as ExpoGraphqlClient;
const channel = {
  id: 'channel-id',
  name: 'production',
  branchMapping: '{"version":0,"data":[]}',
  isProtected: true,
};

function setContext(command: ChannelProtect | ChannelUnprotect): void {
  // @ts-expect-error getContextAsync is protected
  jest.spyOn(command, 'getContextAsync').mockResolvedValue({
    projectId: 'project-id',
    loggedIn: { graphqlClient },
  });
}

describe(ChannelProtect, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(ChannelQuery.viewUpdateChannelBasicInfoAsync).mockResolvedValue(channel);
    jest.mocked(protectUpdateChannelAsync).mockResolvedValue(channel);
  });

  it('protects a named channel', async () => {
    const command = new ChannelProtect(['production'], getMockOclifConfig());
    setContext(command);

    await command.runAsync();

    expect(protectUpdateChannelAsync).toHaveBeenCalledWith(graphqlClient, {
      channelId: 'channel-id',
    });
    expect(Log.withTick).toHaveBeenCalledWith(expect.stringContaining('production'));
  });

  it('prints the server response as JSON', async () => {
    const command = new ChannelProtect(['production', '--json'], getMockOclifConfig());
    setContext(command);

    await command.runAsync();

    expect(enableJsonOutput).toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith(channel);
    expect(Log.withTick).not.toHaveBeenCalled();
  });

  it('requires a channel name in non-interactive mode', async () => {
    const command = new ChannelProtect(['--non-interactive'], getMockOclifConfig());

    await expect(command.runAsync()).rejects.toThrow(
      'Channel name must be set when running in non-interactive mode'
    );
    expect(protectUpdateChannelAsync).not.toHaveBeenCalled();
  });
});

describe(ChannelUnprotect, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(ChannelQuery.viewUpdateChannelBasicInfoAsync).mockResolvedValue(channel);
    jest.mocked(unprotectUpdateChannelAsync).mockResolvedValue({ ...channel, isProtected: false });
    jest.mocked(toggleConfirmAsync).mockResolvedValue(true);
  });

  it('asks for confirmation before removing protection', async () => {
    const command = new ChannelUnprotect(['production'], getMockOclifConfig());
    setContext(command);

    await command.runAsync();

    expect(toggleConfirmAsync).toHaveBeenCalledWith({
      message: expect.stringContaining('production'),
    });
    expect(unprotectUpdateChannelAsync).toHaveBeenCalledWith(graphqlClient, {
      channelId: 'channel-id',
    });
  });

  it('does not mutate the channel when confirmation is declined', async () => {
    jest.mocked(toggleConfirmAsync).mockResolvedValue(false);
    const command = new ChannelUnprotect(['production'], getMockOclifConfig());
    setContext(command);

    await command.runAsync();

    expect(unprotectUpdateChannelAsync).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('production'));
  });

  it('does not prompt in non-interactive mode', async () => {
    const command = new ChannelUnprotect(['production', '--non-interactive'], getMockOclifConfig());
    setContext(command);

    await command.runAsync();

    expect(toggleConfirmAsync).not.toHaveBeenCalled();
    expect(unprotectUpdateChannelAsync).toHaveBeenCalled();
  });

  it('requires a channel name in non-interactive mode', async () => {
    const command = new ChannelUnprotect(['--non-interactive'], getMockOclifConfig());

    await expect(command.runAsync()).rejects.toThrow(
      'Channel name must be set when running in non-interactive mode'
    );
    expect(unprotectUpdateChannelAsync).not.toHaveBeenCalled();
  });
});
