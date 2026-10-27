import { getEasFunctionGroups } from '../easFunctionGroups';

describe(getEasFunctionGroups, () => {
  it('includes eas/maestro_test for non-build jobs', () => {
    const ctx = {
      hasBuildJob: () => false,
      job: {},
    } as unknown as Parameters<typeof getEasFunctionGroups>[0];

    const functionGroupIds = getEasFunctionGroups(ctx).map(functionGroup =>
      functionGroup.getFullId()
    );
    expect(functionGroupIds).toEqual(['eas/maestro_test']);
  });

  it('includes eas/build for build jobs', () => {
    const ctx = {
      hasBuildJob: () => true,
      job: {},
    } as unknown as Parameters<typeof getEasFunctionGroups>[0];

    const functionGroupIds = getEasFunctionGroups(ctx).map(functionGroup =>
      functionGroup.getFullId()
    );
    expect(functionGroupIds).toEqual(expect.arrayContaining(['eas/build', 'eas/maestro_test']));
  });
});
