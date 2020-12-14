import log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { AppLookupParams } from '../credentials';
import { ConfigureProvisioningProfile } from './ConfigureProvisioningProfile';
import { selectDistributionCertificateAsync } from './DistributionCertificateUtils';

export class UseExistingDistributionCertificate implements Action {
  constructor(private app: AppLookupParams) {}

  public async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const selected = await selectDistributionCertificateAsync(ctx, this.app.accountName, {
      filterInvalid: true,
    });
    if (selected) {
      await manager.runActionAsync(new UseSpecificDistributionCertificate(this.app, selected.id));
    }
    const profile = await ctx.ios.getProvisioningProfileAsync(this.app);
    if (profile) {
      await manager.runActionAsync(new ConfigureProvisioningProfile(this.app));
    }
  }
}

export class UseSpecificDistributionCertificate implements Action {
  constructor(private app: AppLookupParams, private userCredentialsId: number | string) {}

  public async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    await ctx.ios.useDistributionCertificateAsync(this.app, this.userCredentialsId);
    log.succeed(
      `Assigned distribution certificate to @${this.app.accountName}/${this.app.projectName} (${this.app.bundleIdentifier})`
    );
  }
}
