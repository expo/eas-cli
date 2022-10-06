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

export enum UserInputResourceClass {
  DEFAULT = 'default',
  LARGE = 'large',
  /**
   * @experimental
   * This resource class is not yet ready to be used in production. For testing purposes only. Might be depricated / deleted at any time.
   */
  M1_EXPERIMENTAL = 'm1-experimental',
}
