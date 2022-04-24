#!/usr/bin/env node
import { Errors, flush, run } from '@oclif/core';

run(undefined, import.meta.url)
  .then(flush)
  .catch(Errors.handle);
