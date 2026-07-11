import EasCommand from '../commandUtils/EasCommand';
import Browse from './browse';

export default class Open extends EasCommand {
  static override description = 'open the project page in a web browser (alias of `eas browse`)';

  async runAsync(): Promise<void> {
    await Browse.run([]);
  }
}
