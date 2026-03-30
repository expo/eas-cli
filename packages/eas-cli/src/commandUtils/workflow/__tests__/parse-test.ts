import { parsedYamlFromWorkflowContents } from '../parse';

describe('parsedYamlFromWorkflowContents', () => {
  it('parses YAML workflow contents', () => {
    const yamlConfig = `
jobs:
  test:
    type: custom
`;

    expect(parsedYamlFromWorkflowContents({ yamlConfig })).toEqual({
      jobs: {
        test: {
          type: 'custom',
        },
      },
    });
  });

  it('supports shared env merge keys across multiple jobs', () => {
    const yamlConfig = `
shared_env: &shared_env
  EXPO_TOKEN: token
  CI: "1"
jobs:
  android:
    type: custom
    env:
      <<: *shared_env
      PLATFORM: android
  ios:
    type: custom
    env:
      <<: *shared_env
      PLATFORM: ios
`;

    expect(parsedYamlFromWorkflowContents({ yamlConfig })).toEqual({
      shared_env: {
        EXPO_TOKEN: 'token',
        CI: '1',
      },
      jobs: {
        android: {
          type: 'custom',
          env: {
            EXPO_TOKEN: 'token',
            CI: '1',
            PLATFORM: 'android',
          },
        },
        ios: {
          type: 'custom',
          env: {
            EXPO_TOKEN: 'token',
            CI: '1',
            PLATFORM: 'ios',
          },
        },
      },
    });
  });
});
