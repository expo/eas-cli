import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import { instance, mock, when } from 'ts-mockito';

import { isEASUpdateConfigured } from '../../../project/projectUtils';
import { BuildContext } from '../../context';
import { resolveChannel } from '../updates';

jest.mock('../../../project/projectUtils', () => ({
  isEASUpdateConfigured: jest.fn(),
}));

describe(resolveChannel, () => {
  it('returns "channel" from build profile if specified', () => {
    jest.mocked(isEASUpdateConfigured).mockReturnValue(true);

    const buildProfileMock = mock<BuildProfile<Platform>>();
    when(buildProfileMock.channel).thenReturn('blahblah');
    const buildProfile = instance(buildProfileMock);

    const ctxMock = mock<BuildContext<Platform>>();
    when(ctxMock.exp).thenReturn({
      name: 'todo',
      slug: 'todo',
      updates: { url: 'http://sokal.dev/todo' },
    });
    when(ctxMock.buildProfileName).thenReturn('production');
    when(ctxMock.buildProfile).thenReturn(buildProfile);
    const ctx = instance(ctxMock);

    expect(resolveChannel(ctx)).toBe('blahblah');
  });

  it('returns undefined if "channel" is not specified in build profile and EAS Update is not configured', () => {
    jest.mocked(isEASUpdateConfigured).mockReturnValue(false);

    const buildProfileMock = mock<BuildProfile<Platform>>();
    when(buildProfileMock.channel).thenReturn(undefined);
    const buildProfile = instance(buildProfileMock);

    const ctxMock = mock<BuildContext<Platform>>();
    when(ctxMock.exp).thenReturn({
      name: 'todo',
      slug: 'todo',
    });
    when(ctxMock.buildProfileName).thenReturn('production');
    when(ctxMock.buildProfile).thenReturn(buildProfile);
    const ctx = instance(ctxMock);

    expect(resolveChannel(ctx)).toBe(undefined);
  });

  it('returns the build profile name if "channel" is not specified in build profile and EAS Update is configured', () => {
    jest.mocked(isEASUpdateConfigured).mockReturnValue(true);

    const buildProfileMock = mock<BuildProfile<Platform>>();
    when(buildProfileMock.channel).thenReturn(undefined);
    const buildProfile = instance(buildProfileMock);

    const ctxMock = mock<BuildContext<Platform>>();
    when(ctxMock.exp).thenReturn({
      name: 'todo',
      slug: 'todo',
      updates: { url: 'http://sokal.dev/todo' },
    });
    when(ctxMock.buildProfileName).thenReturn('production');
    when(ctxMock.buildProfile).thenReturn(buildProfile);
    const ctx = instance(ctxMock);

    expect(resolveChannel(ctx)).toBe('production');
  });
});
