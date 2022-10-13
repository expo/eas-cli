import { appleRules } from '../apple/rules';
import { createValidator, getReadableErrors } from '../utils/ajv';
import { Issue, IssueRule, IssueSeverity } from './issue';
import { MetadataConfig } from './schema';

/** Validate the user-provided validation for issues */
export function validateConfig(config: unknown): Issue[] {
  const validator = createValidator().compile(require('../../../schema/metadata-0.json'));

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

  try {
    issues.push(...validateRules(appleRules, config as MetadataConfig));
  } catch {
    // When the rules are failing, the json schema validation errors explain the issue
    // TODO(cedric): optionally add debugging logging for these types of errors
  }

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
