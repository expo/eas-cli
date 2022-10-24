import { BuildDistributionType } from '../build/types';
import { DistributionType } from '../graphql/generated';

export const buildDistributionTypeToGraphQLDistributionType = (
  buildDistribution?: BuildDistributionType
): DistributionType | undefined => {
  if (buildDistribution === BuildDistributionType.STORE) {
    return DistributionType.Store;
  } else if (buildDistribution === BuildDistributionType.INTERNAL) {
    return DistributionType.Internal;
  } else if (buildDistribution === BuildDistributionType.SIMULATOR) {
    return DistributionType.Simulator;
  } else {
    return undefined;
  }
};
