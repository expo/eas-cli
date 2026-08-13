import type Ajv from 'ajv';
import type { Format, FormatDefinition } from 'ajv';

type FormatCheck = (value: string) => boolean;

/**
 * Whether a value contains a template expression, e.g. `${{ env.SLACK_WEBHOOK_URL }}`.
 * Template expressions are only resolved when the workflow runs, so the literal value that
 * `eas workflow:validate` sees is not the value the job will receive.
 */
export function containsTemplateExpression(value: string): boolean {
  return value.includes('${{') && value.includes('}}');
}

/**
 * Re-declare every string format known to `ajv` so that values containing a template
 * expression satisfy the format, while every other value is still checked as before.
 *
 * The workflow schema is validated against the raw YAML, before any template expression is
 * resolved, so a value such as `webhook_url: ${{ env.SLACK_WEBHOOK_URL }}` can never satisfy
 * `format: uri`. Because job params are declared as an `anyOf`, a single format failure makes
 * the whole job shape unmatchable and the reported errors list every other job type instead.
 *
 * Formats are relaxed generically rather than by name because the workflow schema is fetched
 * from the server at runtime, so the CLI cannot know which formats it will contain.
 */
export function allowTemplateExpressionsInStringFormats(ajv: Ajv): void {
  for (const [name, format] of Object.entries(ajv.formats)) {
    const relaxedFormat = relaxStringFormat(format);
    if (relaxedFormat) {
      ajv.addFormat(name, relaxedFormat);
    }
  }
}

/**
 * Build a replacement for a single format that additionally accepts template expressions.
 * Returns null for formats that must be left untouched, which are formats that either cannot
 * receive a template expression or do not inspect the value at all.
 */
function relaxStringFormat(format: Format | undefined): FormatDefinition<string> | null {
  // `true` accepts every value already, so there is nothing to relax.
  if (format === undefined || typeof format === 'boolean') {
    return null;
  }
  if (format instanceof RegExp) {
    return stringFormat(value => format.test(value));
  }
  if (typeof format === 'function') {
    return stringFormat(format);
  }
  if (typeof format === 'string') {
    // Unreachable in practice: `Ajv.addFormat()` turns a string into a RegExp when it is added.
    const pattern = new RegExp(format);
    return stringFormat(value => pattern.test(value));
  }
  // A number format never receives a template expression, which is always a string, and an
  // async format returns a promise that a synchronous check cannot short-circuit.
  if (format.type === 'number' || format.async === true) {
    return null;
  }
  const { validate } = format as FormatDefinition<string>;
  const check: FormatCheck =
    typeof validate === 'function' ? validate : value => new RegExp(validate).test(value);
  // Spread the original definition so that its other members are preserved, most importantly
  // the `compare` function that the `formatMinimum`/`formatMaximum` keywords rely on.
  return { ...(format as FormatDefinition<string>), ...stringFormat(check) };
}

function stringFormat(check: FormatCheck): FormatDefinition<string> {
  return {
    type: 'string',
    validate: value => containsTemplateExpression(value) || check(value),
  };
}
