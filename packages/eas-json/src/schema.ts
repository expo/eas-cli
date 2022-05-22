import Joi from 'joi';

import { BuildProfileSchema } from './build/schema';
import { SubmitProfileSchema } from './submit/schema';

export const EasJsonSchema = Joi.object({
  cli: Joi.object({
    version: Joi.string(),
    requireCommit: Joi.boolean(),
    enableManagedVersions: Joi.boolean(),
  }),
  build: Joi.object().pattern(Joi.string(), BuildProfileSchema),
  submit: Joi.object().pattern(Joi.string(), SubmitProfileSchema),
});
