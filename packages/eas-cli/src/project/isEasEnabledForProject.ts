import { apiClient } from '../api';

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
  } catch (error) {
    if (error.response?.statusCode === 404) {
      return true;
    } else {
      throw error;
    }
  }
}
