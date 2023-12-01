export enum BuildStatus {
  NEW = 'new',
  IN_QUEUE = 'in-queue',
  IN_PROGRESS = 'in-progress',
  PENDING_CANCEL = 'pending-cancel',
  ERRORED = 'errored',
  FINISHED = 'finished',
  CANCELED = 'canceled',
}

export function maybeGetBuildStatus(
  buildStatusString: string | undefined
): BuildStatus | undefined {
  if (!buildStatusString) {
    return undefined;
  }
  return Object.values(BuildStatus).find(buildStatus => buildStatus === buildStatusString);
}

export enum BuildDistributionType {
  STORE = 'store',
  INTERNAL = 'internal',
  SIMULATOR = 'simulator',
}

export function maybeGetBuildDistributionType(
  buildDistributionTypeString: string | undefined
): BuildDistributionType | undefined {
  if (!buildDistributionTypeString) {
    return undefined;
  }
  return Object.values(BuildDistributionType).find(
    buildDistributionType => buildDistributionType === buildDistributionTypeString
  );
}
