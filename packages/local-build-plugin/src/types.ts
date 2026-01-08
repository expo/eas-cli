import { Metadata } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';

export interface BuildParams {
  workingdir: string;
  env: Record<string, string>;
  metadata: Metadata;
  logger: bunyan;
}
