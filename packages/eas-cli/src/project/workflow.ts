import { Platform, Workflow } from '@expo/eas-build-job';

export async function resolveWorkflowAsync(
  _projectDir: string,
  _platform: Platform
): Promise<Workflow> {
  return Workflow.GENERIC;
}
