import { IosAppBuildCredentialsFragment, IosDistributionType } from '../../../../graphql/generated';
import Log from '../../../../log';
import { promptAsync } from '../../../../prompts';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { getAllBuildCredentialsAsync } from './BuildCredentialsUtils';
import { SetupAdhocProvisioningProfile } from './SetupAdhocProvisioningProfile';
import { SetupProvisioningProfile } from './SetupProvisioningProfile';

export class SetupInternalProvisioningProfile {
  constructor(private app: AppLookupParams) {}

  async runAsync(ctx: Context): Promise<IosAppBuildCredentialsFragment> {
    const buildCredentials = await getAllBuildCredentialsAsync(ctx, this.app);

    const adhocBuildCredentialsExist =
      buildCredentials.filter(
        ({ iosDistributionType }) => iosDistributionType === IosDistributionType.AdHoc
      ).length > 0;
    const enterpriseBuildCredentialsExist =
      buildCredentials.filter(
        ({ iosDistributionType }) => iosDistributionType === IosDistributionType.Enterprise
      ).length > 0;

    if (!ctx.nonInteractive) {
      if (ctx.appStore.authCtx) {
        if (ctx.appStore.authCtx.team.inHouse) {
          return await this.askForDistributionTypeAndSetupAsync(
            ctx,
            'Which credentials would you like to set up?'
          );
        } else {
          return await this.setupAdhocProvisioningProfileAsync(ctx);
        }
      } else {
        if (adhocBuildCredentialsExist && enterpriseBuildCredentialsExist) {
          Log.log('You have set up both adhoc and universal distribution credentials.');
          return await this.askForDistributionTypeAndSetupAsync(
            ctx,
            'Which credentials would you like to use?'
          );
        } else if (adhocBuildCredentialsExist) {
          return await this.setupAdhocProvisioningProfileAsync(ctx);
        } else if (enterpriseBuildCredentialsExist) {
          return await this.setupUniversalProvisioningProfileAsync(ctx);
        } else {
          const { team } = await ctx.appStore.ensureAuthenticatedAsync();
          if (team.inHouse) {
            return await this.askForDistributionTypeAndSetupAsync(
              ctx,
              'Which credentials would you like to set up?'
            );
          } else {
            return await this.setupAdhocProvisioningProfileAsync(ctx);
          }
        }
      }
    } else {
      if (adhocBuildCredentialsExist && enterpriseBuildCredentialsExist) {
        throw new Error(
          `You're in non-interactive mode. You have set up both adhoc and universal distribution credentials. Please set the 'enterpriseProvisioning' property (to 'adhoc' or 'universal') in eas.json to choose the credentials to use.`
        );
      } else if (adhocBuildCredentialsExist) {
        return await this.setupAdhocProvisioningProfileAsync(ctx);
      } else if (enterpriseBuildCredentialsExist) {
        return await this.setupUniversalProvisioningProfileAsync(ctx);
      } else {
        throw new Error(
          `You're in non-interactive mode. EAS CLI couldn't any credentials suitable for internal distribution. Please run again in interactive mode.`
        );
      }
    }
  }

  private async setupAdhocProvisioningProfileAsync(
    ctx: Context
  ): Promise<IosAppBuildCredentialsFragment> {
    return await new SetupAdhocProvisioningProfile(this.app).runAsync(ctx);
  }

  private async setupUniversalProvisioningProfileAsync(
    ctx: Context
  ): Promise<IosAppBuildCredentialsFragment> {
    return await new SetupProvisioningProfile(this.app, IosDistributionType.Enterprise).runAsync(
      ctx
    );
  }

  private async askForDistributionTypeAndSetupAsync(
    ctx: Context,
    message: string
  ): Promise<IosAppBuildCredentialsFragment> {
    const { distributionType } = await promptAsync({
      type: 'select',
      name: 'distributionType',
      message,
      choices: [
        { title: 'Universal Distribution', value: IosDistributionType.Enterprise },
        { title: 'Adhoc Distribution', value: IosDistributionType.AdHoc },
      ],
    });
    if (distributionType === IosDistributionType.Enterprise) {
      return await this.setupUniversalProvisioningProfileAsync(ctx);
    } else {
      return await this.setupAdhocProvisioningProfileAsync(ctx);
    }
  }
}
