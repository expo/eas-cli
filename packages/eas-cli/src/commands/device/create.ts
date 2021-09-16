import EasCommand from '../../commandUtils/EasCommand';
import AppStoreApi from '../../credentials/ios/appstore/AppStoreApi';
import { createContextAsync } from '../../devices/context';
import DeviceManager from '../../devices/manager';
import { ensureLoggedInAsync } from '../../user/actions';

export default class DeviceCreate extends EasCommand {
  static description = 'register new Apple Devices to use for internal distribution';

  async runAsync(): Promise<void> {
    const user = await ensureLoggedInAsync();

    const ctx = await createContextAsync({ appStore: new AppStoreApi(), user });
    const manager = new DeviceManager(ctx);
    await manager.createAsync();
  }
}
