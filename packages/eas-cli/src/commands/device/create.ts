import EasCommand, {
  EASCommandLoggedInContext,
  EASCommandOptionalProjectConfigContext,
} from '../../commandUtils/EasCommand';
import AppStoreApi from '../../credentials/ios/appstore/AppStoreApi';
import { createContextAsync } from '../../devices/context';
import DeviceManager from '../../devices/manager';

export default class DeviceCreate extends EasCommand {
  static override description = 'register new Apple Devices to use for internal distribution';

  static override contextDefinition = {
    ...EASCommandLoggedInContext,
    ...EASCommandOptionalProjectConfigContext,
  };

  async runAsync(): Promise<void> {
    // this command is interactive by design
    const { actor, projectConfig } = await this.getContextAsync(DeviceCreate, {
      nonInteractive: false,
    });

    const ctx = await createContextAsync({
      appStore: new AppStoreApi(),
      user: actor,
      projectId: projectConfig?.projectId,
    });
    const manager = new DeviceManager(ctx);
    await manager.createAsync();
  }
}
