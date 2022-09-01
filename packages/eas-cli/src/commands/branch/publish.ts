import EasCommand from '../../commandUtils/EasCommand';

export default class BranchPublish extends EasCommand {
  static override description = 'deprecated, use "eas update"';
  static override hidden = true;

  async runAsync(): Promise<void> {
    throw new Error(BranchPublish.description);
  }
}
