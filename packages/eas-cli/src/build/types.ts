import { ResourceClass } from '@expo/eas-json';
import { LoggerLevel } from '@expo/logger';

import { LocalBuildOptions } from './local';
import { RequestedPlatform } from '../platform';

export enum BuildStatus {
  NEW = 'new',
  IN_QUEUE = 'in-queue',
  IN_PROGRESS = 'in-progress',
  PENDING_CANCEL = 'pending-cancel',
  ERRORED = 'errored',
  FINISHED = 'finished',
  CANCELED = 'canceled',
}

export enum BuildDistributionType {
  STORE = 'store',
  INTERNAL = 'internal',
  /** @deprecated Use simulator flag instead */
  SIMULATOR = 'simulator',
}

export interface BuildFlags {
  requestedPlatform: RequestedPlatform;
  profile?: string;
  nonInteractive: boolean;
  wait: boolean;
  clearCache: boolean;
  json: boolean;
  autoSubmit: boolean;
  submitProfile?: string;
  localBuildOptions: LocalBuildOptions;
  resourceClass?: ResourceClass;
  message?: string;
  buildLoggerLevel?: LoggerLevel;
  freezeCredentials: boolean;
  repack: boolean;
}
