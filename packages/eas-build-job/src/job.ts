import Joi from 'joi';

import { Platform } from './common';
import * as Android from './android';
import { Generic } from './generic';
import * as Ios from './ios';

export type BuildJob = Android.Job | Ios.Job;
export type Job = BuildJob | Generic.Job;

export const JobSchema = Joi.object<BuildJob>({
  platform: Joi.string()
    .valid(...Object.values(Platform))
    .required(),
})
  .when(Joi.object({ platform: Platform.ANDROID }).unknown(), { then: Android.JobSchema })
  .when(Joi.object({ platform: Platform.IOS }).unknown(), { then: Ios.JobSchema });

export function sanitizeBuildJob(rawJob: object): BuildJob {
  const { value, error } = JobSchema.validate(rawJob, {
    stripUnknown: true,
    convert: true,
    abortEarly: false,
  });

  if (error) {
    throw error;
  } else {
    const job: BuildJob = value;
    return job;
  }
}
