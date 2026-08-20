import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import {
  allowTemplateExpressionsInStringFormats,
  containsTemplateExpression,
} from '../templateExpressions';

function relaxedValidatorForFormat(format: string): (value: unknown) => boolean {
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  allowTemplateExpressionsInStringFormats(ajv);
  return ajv.compile({ type: 'string', format });
}

describe('containsTemplateExpression', () => {
  it('detects a template expression', () => {
    expect(containsTemplateExpression('${{ env.SLACK_WEBHOOK_URL }}')).toBe(true);
    expect(containsTemplateExpression('https://example.com/${{ env.HOOK_ID }}')).toBe(true);
  });

  it('does not detect a template expression in a plain value', () => {
    expect(containsTemplateExpression('https://example.com')).toBe(false);
    expect(containsTemplateExpression('${{')).toBe(false);
  });
});

describe('allowTemplateExpressionsInStringFormats', () => {
  // `ajv-formats` declares formats in three different shapes, and each one has to be wrapped
  // differently. Cover one of each so that no shape is silently left checking nothing.
  it.each([
    ['uri', 'https://hooks.slack.com/services/T000/B000/XXXX', 'not a url'], // plain function
    ['email', 'someone@example.com', 'not an email'], // RegExp
    ['date-time', '2026-02-13T10:00:00Z', 'not a date'], // object with `validate` and `compare`
  ])('accepts a template expression for the `%s` format', (format, validValue, invalidValue) => {
    const validate = relaxedValidatorForFormat(format);

    expect(validate('${{ env.SOME_VALUE }}')).toBe(true);
    // The relaxation must stay narrow: everything that is not a template expression is still
    // checked by the original format.
    expect(validate(validValue)).toBe(true);
    expect(validate(invalidValue)).toBe(false);
  });

  it('leaves formats that accept every value alone', () => {
    // `password` and `binary` are annotation-only formats registered as `true`.
    expect(relaxedValidatorForFormat('password')('anything')).toBe(true);
  });
});
