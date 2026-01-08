import { jsepEval } from '../jsepEval.js';

const TEST_CASES = [
  ['1 + 1', 2],
  ['1 + 3', 4],
  ['1 +3', 4],
  ['"a" + 3', 'a3'],
  ['true', true],
  ['false', false],
  ['!false', true],
  ['"a" !== "b"', true],
  ['"a" === "b"', false],
  ['("a" === "a") && false', false],
  ['("a" === "a") || false', true],
  ['this.missing', undefined],
  ['this["missing"]', undefined],
  ['1 + eas', 2, { eas: 1 }],
  ['1 + eas.jobCount', 10, { eas: { jobCount: 9 } }],
  [
    'success() && env.NODE_ENV === "staging"',
    true,
    { success: () => true, env: { NODE_ENV: 'staging' } },
  ],
  [
    'success() && env.NODE_ENV === "staging"',
    false,
    { success: () => true, env: { NODE_ENV: 'production' } },
  ],
  ['0 == 1 ? "a" : "b"', 'b'],
  ['fromJSON("{\\"a\\": 1}").a', 1, { fromJSON: JSON.parse }],
  ['fromJSON("{\\"a\\": 1}")[fromJSON(\'"a"\')]', 1, { fromJSON: JSON.parse }],
  ['fromJSON(null).a', undefined, { fromJSON: JSON.parse }],
] as const;

describe(jsepEval, () => {
  it('works', () => {
    for (const [expr, expectation, context] of TEST_CASES) {
      expect(jsepEval(expr, context)).toBe(expectation);
    }
  });
});
