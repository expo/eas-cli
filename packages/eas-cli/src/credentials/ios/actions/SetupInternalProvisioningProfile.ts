import { IosAppBuildCredentialsFragment, IosDistributionType } from '../../../graphql/generated';
import Log from '../../../log';
import { promptAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';
import { getAllBuildCredentialsAsync } from './BuildCredentialsUtils';
import { SetupAdhocProvisioningProfile } from './SetupAdhocProvisioningProfile';
import { SetupProvisioningProfile } from './SetupProvisioningProfile';

/**
 * It's used when setting up credentials for internal distribution but `enterpriseProvisioning` is not set.
 *
 * TLDR: If the user authenticates with an account with Apple Developer Enterprise Program membership we ask them
 * to choose if they want to set up an adhoc or universal distribution provisioning profile. Otherwise, always
 * set up an adhoc provisioning profile.
 */
export class SetupInternalProvisioningProfile {
  constructor(private app: AppLookupParams) {}

  async runAsync(ctx: CredentialsContext): Promise<IosAppBuildCredentialsFragment> {
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
          `You're in non-interactive mode. EAS CLI couldn't find any credentials suitable for internal distribution. Please run again in interactive mode.`
        );
      }
    }
  }

  private async setupAdhocProvisioningProfileAsync(
    ctx: CredentialsContext
  ): Promise<IosAppBuildCredentialsFragment> {
    return await new SetupAdhocProvisioningProfile(this.app).runAsync(ctx);
  }

  private async setupUniversalProvisioningProfileAsync(
    ctx: CredentialsContext
  ): Promise<IosAppBuildCredentialsFragment> {
    return await new SetupProvisioningProfile(this.app, IosDistributionType.Enterprise).runAsync(
      ctx
    );
  }

  private async askForDistributionTypeAndSetupAsync(
    ctx: CredentialsContext,
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
