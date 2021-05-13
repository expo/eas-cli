import { Platform, Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';

export function resolveWorkflow(projectDir: string, platform: Platform): Workflow {
  return fs.pathExistsSync(path.join(projectDir, platform)) ? Workflow.GENERIC : Workflow.MANAGED;
}
