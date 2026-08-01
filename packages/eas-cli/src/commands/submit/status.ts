import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { AppPlatform, SubmissionWithSubmittedBuildFragment } from '../../graphql/generated';
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
    'show the status of your app on the stores: the live App Store version, TestFlight builds, and Google Play tracks\n\n' +
    'The iOS section reads from App Store Connect and requires an ASC API key. Provide one via:\n' +
    '  - Environment variables: EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID\n' +
    '  - eas.json submit profile: ascApiKeyPath, ascApiKeyId, ascApiKeyIssuerId\n' +
    '  - EAS credentials service: run `eas credentials` to set up an API key\n' +
    'Without a key, the command offers an interactive Apple login; in non-interactive mode the iOS section is skipped (or the command fails when only iOS was requested).\n\n' +
    'The Android section is derived from finished EAS submissions and requires no Google Play credentials. The Play Console remains the authoritative source for the live release state.';

  static override examples = [
    '$ eas submit:status  \t # App Store, TestFlight, and Play track status for both platforms',
    '$ eas submit:status -p ios  \t # iOS only',
    '$ eas submit:status --json --non-interactive  \t # machine-readable output',
  ];

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

    // Fetch each platform's page separately: one unfiltered page could fill up with
    // submissions from the other platform and hide the requested platform's history.
    const spinner = ora().start('Fetching submissions…');
    let iosSubmissions: SubmissionWithSubmittedBuildFragment[] = [];
    let androidSubmissions: SubmissionWithSubmittedBuildFragment[] = [];
    try {
      [iosSubmissions, androidSubmissions] = await Promise.all([
        includeIos
          ? getRecentSubmissionsAsync(graphqlClient, {
              projectId,
              filter: { platform: AppPlatform.Ios },
            })
          : [],
        includeAndroid
          ? getRecentSubmissionsAsync(graphqlClient, {
              projectId,
              filter: { platform: AppPlatform.Android },
            })
          : [],
      ]);
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
          iosStatus = await getIosStoreStatusAsync(app, iosSubmissions);
          ascSpinner.stop();
        } catch (error) {
          ascSpinner.fail("Something went wrong and we couldn't fetch the App Store status.");
          throw error;
        }
      } catch (error: unknown) {
        // With only iOS requested there is nothing left to show, so fail loudly. When Android
        // was also requested, degrade to a warning and still render the Android section.
        if (!includeAndroid) {
          throw error;
        }
        iosError = error instanceof Error ? error.message : String(error);
        Log.warn(`Skipping iOS App Store status: ${iosError}`);
      }
    }

    const androidStatuses = includeAndroid ? getAndroidTrackStatuses(androidSubmissions) : null;

    if (jsonFlag) {
      printJsonOnlyOutput({
        ...(includeIos && { ios: iosStatus ?? { error: iosError } }),
        ...(includeAndroid && { android: { tracks: androidStatuses } }),
      });
      return;
    }

    if (iosStatus) {
      renderIosStoreStatus(iosStatus, iosSubmissions);
    }
    if (androidStatuses) {
      renderAndroidTrackStatuses(androidStatuses);
    }
  }
}
