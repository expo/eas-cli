import assert from 'assert';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  MarkCliDoneInOnboardingUserPreferencesMutation,
  MarkCliDoneInOnboardingUserPreferencesMutationVariables,
  UserPreferencesOnboardingInput,
} from '../generated';

export const UserPreferencesMutation = {
  async markCliDoneInOnboardingUserPreferencesAsync(
    graphqlClient: ExpoGraphqlClient,
    userPreferencesData: Partial<UserPreferencesOnboardingInput> & { appId: string }
  ): Promise<{
    isCLIDone: boolean;
    appId: string;
  }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          MarkCliDoneInOnboardingUserPreferencesMutation,
          MarkCliDoneInOnboardingUserPreferencesMutationVariables
        >(
          gql`
            mutation MarkCliDoneInOnboardingUserPreferencesMutation(
              $preferences: UserPreferencesInput!
            ) {
              me {
                setPreferences(preferences: $preferences) {
                  onboarding {
                    appId
                    isCLIDone
                  }
                }
              }
            }
          `,
          {
            preferences: {
              onboarding: {
                ...userPreferencesData,
                isCLIDone: true,
                lastUsed: new Date().toISOString(),
              },
            },
          }
        )
        .toPromise()
    );
    const appId = data.me.setPreferences.onboarding?.appId;
    assert(appId, 'App ID must be defined');
    const isCLIDone = data.me.setPreferences.onboarding?.isCLIDone;
    assert(isCLIDone, 'isCLIDone must be defined and true');
    return {
      appId,
      isCLIDone,
    };
  },
};
