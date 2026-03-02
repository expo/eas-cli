import EasCommand from '../../commandUtils/EasCommand';
import omit from '../../utils/expodash/omit';
import UpdatePublish from '../update';

export default class PreviewGo extends EasCommand {
  static override description = 'Publish an update that is compatible with Expo Go';

  static override flags = omit(UpdatePublish.flags, ['source-maps', 'no-bytecode']);

  static override args = UpdatePublish.args;

  static override contextDefinition = UpdatePublish.contextDefinition;

  static override hidden = true; // hidden for now until feature is settled

  override async runAsync(): Promise<void> {
    await this.parse(PreviewGo); // validation only

    const newArgv = [...this.argv, '--source-maps', 'inline', '--no-bytecode'];
    await UpdatePublish.run(newArgv, this.config);
  }
}
