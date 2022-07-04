import EasCommand from '../../commandUtils/EasCommand.js';
import AppStoreApi from '../../credentials/ios/appstore/AppStoreApi.js';
import { createContextAsync } from '../../devices/context.js';
import DeviceManager from '../../devices/manager.js';
import { ensureLoggedInAsync } from '../../user/actions.js';

export default class DeviceCreate extends EasCommand {
  static description = 'register new Apple Devices to use for internal distribution';

  async runAsync(): Promise<void> {
    const user = await ensureLoggedInAsync();

    const ctx = await createContextAsync({ appStore: new AppStoreApi(), user });
    const manager = new DeviceManager(ctx);
    await manager.createAsync();
  }
}
