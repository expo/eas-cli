import Log from '../../../log';
import { maybeWarnAboutNonStandardBuildType } from '../build';

const warn = jest.spyOn(Log, 'warn');

describe('maybeWarnAboutNonStandardBuildType', () => {
  it('should not warn about non-standard build type', () => {
    const buildProfile = {
      gradleCommand: ':app:buildRelease',
    };

    maybeWarnAboutNonStandardBuildType({ buildProfile, buildType: 'release' });

    expect(warn).not.toHaveBeenCalled();
  });

  it('should warn about non-standard build type', () => {
    const buildProfile = {
      gradleCommand: ':app:buildStage',
    };

    maybeWarnAboutNonStandardBuildType({ buildProfile, buildType: 'stage' });

    expect(warn).toHaveBeenCalled();
  });
});
