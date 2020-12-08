import { Command } from '@oclif/command';

import AppStoreApi from '../../credentials/ios/appstore/AppStoreApi';
import { createContext } from '../../devices/context';
import DeviceManager from '../../devices/manager';
import { ensureLoggedInAsync } from '../../user/actions';

export default class DeviceCreate extends Command {
  static description = 'register new Apple Devices to use for internal distribution';
  static aliases = ['device'];

  async run() {
    const user = await ensureLoggedInAsync();

    const ctx = await createContext({ appStore: new AppStoreApi(), user });
    const manager = new DeviceManager(ctx);
    await manager.createAsync();
  }
}
