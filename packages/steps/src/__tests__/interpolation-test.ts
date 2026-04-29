import { JobInterpolationContext } from '@expo/eas-build-job';

import { interpolateJobContext } from '../interpolation';

const context = {
  inputs: {
    profile: 'production',
    flags: { quiet: true, retries: 3 },
  },
  github: {
    event: {
      pull_request: {
        html_url: 'https://github.com/foo/bar/pull/42',
        title: 'Add cool feature',
      },
    },
  },
} as unknown as JobInterpolationContext;

describe(interpolateJobContext, () => {
  test('single expression value preserves the underlying type', () => {
    const result = interpolateJobContext({
      target: '${{ inputs.flags }}',
      context,
    });
    expect(result).toEqual({ quiet: true, retries: 3 });
  });

  test('single expression value resolves to a string', () => {
    const result = interpolateJobContext({
      target: '${{ inputs.profile }}',
      context,
    });
    expect(result).toBe('production');
  });

  test('multiple expressions in one value are each replaced with their string result', () => {
    const result = interpolateJobContext({
      target:
        '${{ github.event.pull_request.html_url }}: ${{ github.event.pull_request.title }}',
      context,
    });
    expect(result).toBe('https://github.com/foo/bar/pull/42: Add cool feature');
  });

  test('plain text is returned unchanged', () => {
    const result = interpolateJobContext({ target: 'just text', context });
    expect(result).toBe('just text');
  });

  test('expression with text around it is interpolated as a string', () => {
    const result = interpolateJobContext({
      target: 'profile=${{ inputs.profile }}',
      context,
    });
    expect(result).toBe('profile=production');
  });

  test('object values recurse', () => {
    const result = interpolateJobContext({
      target: { profile: '${{ inputs.profile }}', literal: 'x' },
      context,
    });
    expect(result).toEqual({ profile: 'production', literal: 'x' });
  });

  test('array values recurse', () => {
    const result = interpolateJobContext({
      target: ['${{ inputs.profile }}', 'literal'],
      context,
    });
    expect(result).toEqual(['production', 'literal']);
  });

  test('string concatenation inside a single expression', () => {
    const result = interpolateJobContext({
      target:
        "${{ github.event.pull_request.html_url + ': ' + github.event.pull_request.title }}",
      context,
    });
    expect(result).toBe('https://github.com/foo/bar/pull/42: Add cool feature');
  });
});
