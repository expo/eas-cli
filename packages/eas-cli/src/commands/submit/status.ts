import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { AppPlatform } from '../../graphql/generated';
import Log from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform } from '../../platform';
import { getRecentSubmissionsAsync } from '../../submit/queries';
import {
  IosStoreStatus,
  getAndroidTrackStatuses,
  getIosStoreStatusAsync,
  renderAndroidTrackStatuses,
  renderIosStoreStatus,
} from '../../submit/status';
import { resolveTestFlightAppAsync } from '../../testflight/app';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class SubmissionStatus extends EasCommand {
  static override description =
    'show the status of your app on the stores: the live App Store version, TestFlight builds, and Google Play tracks';

  static override flags = {
    platform: Flags.option({
      char: 'p',
      options: Object.values(RequestedPlatform),
    })(),
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the submit profile from eas.json used to resolve the App Store Connect API key. Defaults to "production".',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SubmissionStatus);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const requestedPlatform = flags.platform ?? RequestedPlatform.All;

    const {
      loggedIn: { actor, graphqlClient },
      privateProjectConfig: { exp, projectId, projectDir },
      analytics,
      vcsClient,
    } = await this.getContextAsync(SubmissionStatus, {
      nonInteractive,
      withServerSideEnvironment: null,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    const includeIos = [RequestedPlatform.All, RequestedPlatform.Ios].includes(requestedPlatform);
    const includeAndroid = [RequestedPlatform.All, RequestedPlatform.Android].includes(
      requestedPlatform
    );

    const spinner = ora().start('Fetching submissions…');
    let easSubmissions;
    try {
      easSubmissions = await getRecentSubmissionsAsync(graphqlClient, { projectId });
      spinner.stop();
    } catch (error) {
      spinner.fail("Something went wrong and we couldn't fetch the submissions for this project.");
      throw error;
    }

    let iosStatus: IosStoreStatus | null = null;
    let iosError: string | null = null;
    if (includeIos) {
      try {
        const app = await resolveTestFlightAppAsync({
          actor,
          analytics,
          exp,
          graphqlClient,
          nonInteractive,
          profileName: flags.profile,
          projectDir,
          projectId,
          vcsClient,
        });
        const ascSpinner = ora().start('Fetching App Store status…');
        try {
          iosStatus = await getIosStoreStatusAsync(
            app,
            easSubmissions.filter(submission => submission.platform === AppPlatform.Ios)
          );
          ascSpinner.stop();
        } catch (error) {
          ascSpinner.fail("Something went wrong and we couldn't fetch the App Store status.");
          throw error;
        }
      } catch (error: unknown) {
        iosError = error instanceof Error ? error.message : String(error);
        Log.warn(`Skipping iOS App Store status: ${iosError}`);
      }
    }

    const androidStatuses = includeAndroid ? getAndroidTrackStatuses(easSubmissions) : null;

    if (jsonFlag) {
      printJsonOnlyOutput({
        ...(includeIos && { ios: iosStatus ?? { error: iosError } }),
        ...(includeAndroid && { android: { tracks: androidStatuses } }),
      });
      return;
    }

    if (iosStatus) {
      renderIosStoreStatus(
        iosStatus,
        easSubmissions.filter(submission => submission.platform === AppPlatform.Ios)
      );
    }
    if (androidStatuses) {
      renderAndroidTrackStatuses(androidStatuses);
    }
  }
}
