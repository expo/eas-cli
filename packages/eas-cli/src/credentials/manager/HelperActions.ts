import { constants } from 'os';

import log from '../../log';
import { Action, CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';

export class PressAnyKeyToContinue implements Action {
  public async runAsync(manmager: CredentialsManager, context: Context): Promise<void> {
    log('Press any key to continue...');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    await new Promise(res => {
      process.stdin.on('data', key => {
        if (String(key) === '\u0003') {
          process.exit(constants.signals.SIGINT + 128); // ctrl-c
        }
        res();
      });
    });
    log.newLine();
    log.newLine();
  }
}
