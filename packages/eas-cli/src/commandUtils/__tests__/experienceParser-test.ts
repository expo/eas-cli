import {
  experienceToAccountName,
  fullNameToSlug,
  isValidExperienceName,
  isValidSlugStrict,
} from '../experienceParser';

describe(isValidExperienceName, () => {
  it.each([
    ['wat', false],
    ['@wat', false],
    ['@wat/', false],
    ['@wat/hello', true],
  ])('case %p', (candidate, shouldBeValid) => {
    expect(isValidExperienceName(candidate)).toEqual(shouldBeValid);
  });
});

describe(experienceToAccountName, () => {
  it('parses account name', () => {
    expect(experienceToAccountName('@wat/huh')).toEqual('wat');
  });
});

describe(fullNameToSlug, () => {
  it('parses slug', () => {
    expect(fullNameToSlug('@wat/huh')).toEqual('huh');
  });
});

describe(isValidSlugStrict, () => {
  it.each([
    ['wat', true],
    ['wat123456-hello-what123456', true],
    ['@wat', false],
    ['@wat/', false],
    ['@wat/hello', false],
  ])('case %p', (candidate, shouldBeValid) => {
    expect(isValidSlugStrict(candidate)).toEqual(shouldBeValid);
  });
});
