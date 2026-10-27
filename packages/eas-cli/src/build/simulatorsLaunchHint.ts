import { boolish } from 'getenv';

import { Analytics, BuildEvent } from '../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { UserPreferenceMutation } from '../graphql/mutations/UserPreferenceMutation';
import { UserPreferenceQuery } from '../graphql/queries/UserPreferenceQuery';
import Log, { link } from '../log';

const SIMULATORS_LAUNCH_AT = new Date('2026-11-05T18:00:00Z');
const SIMULATORS_LAUNCH_HINT_PREFERENCE_KEY = 'simulators-launch-cli-hint-seen';
const SIMULATORS_QUICKSTART_URL =
  'https://docs.expo.dev/preview/simulators/get-started/?utm_source=eas-cli&utm_medium=cli&utm_campaign=simulators-launch';

export async function maybeShowSimulatorsLaunchHintAsync(
  graphqlClient: ExpoGraphqlClient,
  analytics: Analytics,
  { nonInteractive }: { nonInteractive: boolean }
): Promise<void> {
  if (nonInteractive || boolish('CI', false) || Date.now() < SIMULATORS_LAUNCH_AT.getTime()) {
    return;
  }
  try {
    const value = await UserPreferenceQuery.getValueAsync(
      graphqlClient,
      SIMULATORS_LAUNCH_HINT_PREFERENCE_KEY
    );
    if (value && typeof value === 'object' && 'isDismissed' in value && value.isDismissed) {
      return;
    }
    Log.newLine();
    Log.log(
      `✨ New: run your build in Expo Simulators, cloud iOS and Android simulators for you and your agents. ${link(SIMULATORS_QUICKSTART_URL)}`
    );
    analytics.logEvent(BuildEvent.SIMULATORS_LAUNCH_HINT_SHOWN, {});
    await UserPreferenceMutation.setAsync(graphqlClient, SIMULATORS_LAUNCH_HINT_PREFERENCE_KEY, {
      isDismissed: true,
    });
  } catch (error) {
    Log.debug('Failed to show the Expo Simulators hint', error);
  }
}
