export enum BuildStatus {
  NEW = 'new',
  IN_QUEUE = 'in-queue',
  IN_PROGRESS = 'in-progress',
  ERRORED = 'errored',
  FINISHED = 'finished',
  CANCELED = 'canceled',
}

export enum BuildDistributionType {
  STORE = 'store',
  INTERNAL = 'internal',
  SIMULATOR = 'simulator',
}
