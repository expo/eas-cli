import assert from 'assert';
import chalk from 'chalk';

import log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { IosDistCredentials } from '../credentials';
import { displayIosUserCredentials } from '../utils/printCredentials';
import { provideOrGenerateDistributionCertificateAsync } from './DistributionCertificateUtils';

export class CreateDistributionCertificateStandaloneManager implements Action {
  constructor(private accountName: string) {}

  public async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const action = new CreateDistributionCertificate(this.accountName);
    await manager.runActionAsync(action);

    log.newLine();
    displayIosUserCredentials(action.distCredentials);
    log.newLine();
  }
}

export class CreateDistributionCertificate implements Action {
  private _distCredentials?: IosDistCredentials;

  constructor(private accountName: string) {}

  public get distCredentials(): IosDistCredentials {
    assert(this._distCredentials, 'distCredentials can be accessed only after runAsync');
    return this._distCredentials;
  }

  public async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const distCert = await provideOrGenerateDistributionCertificateAsync(
      manager,
      ctx,
      this.accountName
    );
    this._distCredentials = await ctx.ios.createDistributionCertificateAsync(
      this.accountName,
      distCert
    );
    log(chalk.green('Successfully created Distribution Certificate.'));
  }
}
