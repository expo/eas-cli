import { validateConfig } from '../validate';

function reviewConfig(review: Record<string, unknown>): Record<string, unknown> {
  return {
    configVersion: 0,
    apple: {
      review: {
        firstName: 'Expo',
        lastName: 'Tester',
        email: 'review@example.com',
        phone: '+1 555 0100',
        ...review,
      },
    },
  };
}

describe(validateConfig, () => {
  it('accepts a demo password within the App Store Connect limit', () => {
    expect(validateConfig(reviewConfig({ demoPassword: 'p'.repeat(100) }))).toEqual([]);
  });

  it('reports a demo password longer than App Store Connect accepts', () => {
    // Without this, the push only fails at upload time with "An attribute value is too
    // long. - Password cannot be longer than 100 characters."
    const issues = validateConfig(reviewConfig({ demoPassword: 'p'.repeat(101) }));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: ['apple', 'review', 'demoPassword'],
      message: expect.stringContaining('100 characters or fewer'),
    });
  });
});
