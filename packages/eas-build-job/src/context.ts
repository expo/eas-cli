import { DynamicInterpolationContext, StaticWorkflowInterpolationContext } from './common';
import { Job } from './job';
import { Metadata } from './metadata';

type StaticJobOnlyInterpolationContext = {
  job: Job;
  metadata: Metadata | null;
  steps: Record<
    string,
    {
      outputs: Record<string, string | undefined>;
    }
  >;
  expoApiServerURL: string;
};

export type StaticJobInterpolationContext =
  | (StaticWorkflowInterpolationContext & StaticJobOnlyInterpolationContext)
  | StaticJobOnlyInterpolationContext;

export type JobInterpolationContext = StaticJobInterpolationContext & DynamicInterpolationContext;
