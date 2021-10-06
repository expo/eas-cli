import { getConfig } from '@expo/config';

import EasCommand from '../../commandUtils/EasCommand';
import { AppleDeviceQuery } from '../../credentials/ios/api/graphql/queries/AppleDeviceQuery';
import formatDevice from '../../devices/utils/formatDevice';
import Log from '../../log';
import { ora } from '../../ora';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';

export default class DeviceView extends EasCommand {
  static description = 'view a device for your project';

  static args = [{ name: 'UDID' }];

  async runAsync(): Promise<void> {
    const { UDID } = this.parse(DeviceView).args;

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

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const accountName = await getProjectAccountNameAsync(exp);

    const spinner = ora().start(`Fetching device details for ${UDID}…`);

    try {
      const device = await AppleDeviceQuery.getByDeviceIdentifierAsync(accountName, UDID);

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
