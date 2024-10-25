import EasCommand from '../../commandUtils/EasCommand';
import { AppleDeviceQuery } from '../../credentials/ios/api/graphql/queries/AppleDeviceQuery';
import formatDevice from '../../devices/utils/formatDevice';
import Log from '../../log';
import { ora } from '../../ora';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';

export default class DeviceView extends EasCommand {
  static override description = 'view a device for your project';

  static override args = [{ name: 'UDID' }];

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { UDID } = (await this.parse(DeviceView)).args;

    if (!UDID) {
      Log.log(
        `The device UDID is required to view a specific device. For example:

   eas device:view 00005787-000872430189501D

If you are not sure what is the UDID of the device you are looking for, run:

   eas device:list
`
      );
      throw new Error('Device UDID is missing');
    }
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(DeviceView, {
      nonInteractive: true,
    });
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    const spinner = ora().start(`Fetching device details for ${UDID}…`);

    try {
      const device = await AppleDeviceQuery.getByDeviceIdentifierAsync(
        graphqlClient,
        account.name,
        UDID
      );

      if (device) {
        spinner.succeed('Fetched device details');
        Log.log(`\n${formatDevice(device, device.appleTeam)}`);
      } else {
        spinner.fail(`Couldn't find a device with the UDID ${UDID}`);
      }
    } catch (e) {
      spinner.fail(`Something went wrong and we couldn't fetch the device with UDID ${UDID}`);
      throw e;
    }
  }
}
