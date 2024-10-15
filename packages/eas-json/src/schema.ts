import Joi from 'joi';

import { BuildProfileSchema } from './build/schema';
import { UnresolvedSubmitProfileSchema } from './submit/schema';
import { AppVersionSource } from './types';

export const EasJsonSchema = Joi.object({
  $schema: Joi.string(),
  cli: Joi.object({
    version: Joi.string(),
    requireCommit: Joi.boolean(),
    appVersionSource: Joi.string().valid(...Object.values(AppVersionSource)),
    promptToConfigurePushNotifications: Joi.boolean(),
  }),
  build: Joi.object().pattern(Joi.string(), BuildProfileSchema),
  submit: Joi.object().pattern(Joi.string(), UnresolvedSubmitProfileSchema),
});
