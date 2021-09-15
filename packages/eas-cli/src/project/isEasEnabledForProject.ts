import chalk from 'chalk';

import { apiClient } from '../api';
import Log from '../log';

/**
 * Checks if the project is allowed for using EAS services.
 * THIS IS A TEMPORARY STEP NEEDED FOR OPEN PREVIEW
 * @returns boolean
 */
export async function isEasEnabledForProjectAsync(projectId: string): Promise<boolean> {
  try {
    const {
      data: { enabled },
    } = await apiClient.get(`projects/${projectId}/eas-enabled`).json();
    return enabled;
  } catch (error: any) {
    if (error.response?.statusCode === 404) {
      return true;
    } else {
      throw error;
    }
  }
}

export const EAS_UNAVAILABLE_MESSAGE = `Your account doesn't have access to Expo Application Services (EAS) features. Enroll in EAS to give it a try: ${chalk.underline(
  'https://expo.dev/eas'
)}`;

export function warnEasUnavailable(): void {
  Log.warn(EAS_UNAVAILABLE_MESSAGE);
}
