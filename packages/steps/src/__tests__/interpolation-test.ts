import type { JobInterpolationContext } from '@expo/eas-build-job';

import { interpolateJobContext } from '../interpolation';

describe(interpolateJobContext, () => {
  it('interpolates multiple ${{ }} segments when the string starts with ${{ and ends with }}', () => {
    const context = {
      github: {
        event: {
          pull_request: {
            html_url: 'https://github.com/acme/app/pull/42',
            title: 'Fix crash',
          },
        },
      },
    } as unknown as JobInterpolationContext;

    expect(
      interpolateJobContext({
        target: '${{ github.event.pull_request.html_url }}: ${{ github.event.pull_request.title }}',
        context,
      })
    ).toBe('https://github.com/acme/app/pull/42: Fix crash');
  });

  it('still preserves non-string types for a single whole-string interpolation', () => {
    const context = {
      build: { profile: 'production', id: '123' },
    } as unknown as JobInterpolationContext;

    expect(
      interpolateJobContext({
        target: '${{ build }}',
        context,
      })
    ).toEqual({ profile: 'production', id: '123' });
  });

  it("handles a single interpolation when the expression contains '}}' in a string literal", () => {
    const context = {
      build: { profile: 'production}}' },
    } as unknown as JobInterpolationContext;

    expect(
      interpolateJobContext({
        target: "${{ build.profile == 'production}}' }}",
        context,
      })
    ).toBe(true);
  });
});
