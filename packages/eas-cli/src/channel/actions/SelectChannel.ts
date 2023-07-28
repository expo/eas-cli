import { EASUpdateAction, EASUpdateContext, NonInteractiveError } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import { promptAsync } from '../../prompts';
import { getChannelsDatasetAsync } from '../queries';

/**
 * Select a channel for the project.
 *
 * @constructor
 * @param {function} options.filterPredicate - A predicate to filter the channels that are shown to the user. It takes a channelInfo object as a parameter and returns a boolean.
 * @param {string} options.printedType - The type of channel printed to the user. Defaults to 'channel'.
 */
export class SelectChannel implements EASUpdateAction<UpdateChannelBasicInfoFragment | null> {
  constructor(
    private options: {
      filterPredicate?: (channelInfo: UpdateChannelBasicInfoFragment) => boolean;
      printedType?: string;
    } = {}
  ) {}
  public async runAsync(ctx: EASUpdateContext): Promise<UpdateChannelBasicInfoFragment | null> {
    const { nonInteractive, graphqlClient, app } = ctx;
    const { projectId } = app;
    const { filterPredicate } = this.options;
    const printedType = this.options.printedType ?? 'channel';
    if (nonInteractive) {
      throw new NonInteractiveError(
        `${printedType} selection cannot be run in non-interactive mode.`
      );
    }

    const channels = await getChannelsDatasetAsync(graphqlClient, {
      appId: projectId,
      filterPredicate,
    });

    if (channels.length === 0) {
      return null;
    } else if (channels.length === 1) {
      return channels[0];
    }

    const { channel: selectedChannel } = await promptAsync({
      type: 'select',
      name: 'channel',
      message: `Select a ${printedType}`,
      choices: channels.map(channel => ({
        value: channel,
        title: channel.name,
      })),
    });
    return selectedChannel;
  }
}
