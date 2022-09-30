import { appleRules } from '../apple/rules';
import { createValidator, getReadableErrors } from '../utils/ajv';
import { Issue, IssueRule, IssueSeverity } from './issue';
import { MetadataConfig } from './schema';

/** The pre-compiled AJV validator instance, with the metadata spec */
const validator = createValidator().compile(require('../../../schema/metadata-0.json'));

/** Validate the user-provided validation for issues */
export function validateConfig(config: unknown): Issue[] {
  validator(config);

  const issues: Issue[] = getReadableErrors(validator.errors ?? []).map(error => {
    const path = error.path === '$' ? [] : error.path.substring(2).split('.');
    const id = error.original?.keyword ?? 'unknown';

    return {
      id: `json-schema.${id}`,
      path,
      severity: IssueSeverity.error,
      message: error.message,
    };
  });

  // TODO(cedric): check if it's safe to run this without valid schema
  issues.push(...validateRules(appleRules, config as MetadataConfig));

  return issues;
}

/** Validate the set of rules against the parsed metadata config */
function validateRules(rules: IssueRule[], config: MetadataConfig): Issue[] {
  const issues: Issue[] = [];

  for (const rule of rules) {
    const result = rule.validate(config);

    if (Array.isArray(result)) {
      issues.push(...result);
    } else if (result) {
      issues.push(result);
    }
  }

  return issues;
}
