import EasCommand from '../../commandUtils/EasCommand';
import AppStoreApi from '../../credentials/ios/appstore/AppStoreApi';
import { createContextAsync } from '../../devices/context';
import DeviceManager from '../../devices/manager';

export default class DeviceCreate extends EasCommand {
  static override description = 'register new Apple Devices to use for internal distribution';

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.OptionalProjectConfig,
  };

  async runAsync(): Promise<void> {
    // this command is interactive by design
    const {
      loggedIn: { actor, graphqlClient },
      optionalPrivateProjectConfig: privateProjectConfig,
    } = await this.getContextAsync(DeviceCreate, {
      nonInteractive: false,
      withServerSideEnvironment: null,
    });

    const ctx = await createContextAsync({
      appStore: new AppStoreApi(),
      user: actor,
      graphqlClient,
      projectId: privateProjectConfig?.projectId,
    });
    const manager = new DeviceManager(ctx);
    await manager.createAsync();
  }
}
