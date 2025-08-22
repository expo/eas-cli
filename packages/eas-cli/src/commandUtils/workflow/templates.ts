export enum WorkflowTemplateName {
  DEVELOPMENT_BUILDS = 'development-builds',
  PUBLISH_PREVIEW_UPDATES = 'publish-preview-updates',
  DEPLOY_TO_PRODUCTION = 'deploy-to-production',
  CUSTOM = 'custom',
}

export type WorkflowTemplate = {
  name: WorkflowTemplateName;
  displayName: string;
  defaultFileName: string;
  template: string;
};

const CUSTOM_TEMPLATE = `name: Custom build

on:
  push:
    branches: ['*']

jobs:
  custom_build:
    steps:
      - uses: eas/checkout
      - run: echo "Hello, World"
`;

const DEVELOPMENT_BUILD_TEMPLATE = `name: Create development builds

jobs:
  android_development_build:
    name: Build Android
    type: build
    params:
      platform: android
      profile: development
  ios_device_development_build:
    name: Build iOS device
    type: build
    params:
      platform: ios
      profile: development
  ios_simulator_development_build:
    name: Build iOS simulator
    type: build
    params:
      platform: ios
      profile: development-simulator
`;

const PUBLISH_PREVIEW_UPDATE_TEMPLATE = `name: Publish preview updates

jobs:
  publish_preview_update:
    name: Publish preview update
    type: update
    params:
      channel: preview
`;

const DEPLOY_TO_PRODUCTION_TEMPLATE = `name: Deploy to production

on:
  push:
    branches: ['main']

jobs:
  fingerprint:
    name: Fingerprint
    type: fingerprint
  get_android_build:
    name: Check for existing android build
    needs: [fingerprint]
    type: get-build
    params:
      fingerprint_hash: \${{ needs.fingerprint.outputs.android_fingerprint_hash }}
      profile: production
  get_ios_build:
    name: Check for existing ios build
    needs: [fingerprint]
    type: get-build
    params:
      fingerprint_hash: \${{ needs.fingerprint.outputs.ios_fingerprint_hash }}
      profile: production
  build_android:
    name: Build Android
    needs: [get_android_build]
    if: \${{ !needs.get_android_build.outputs.build_id }}
    type: build
    params:
      platform: android
      profile: production
  build_ios:
    name: Build iOS
    needs: [get_ios_build]
    if: \${{ !needs.get_ios_build.outputs.build_id }}
    type: build
    params:
      platform: ios
      profile: production
  submit_android_build:
    name: Submit Android Build
    needs: [build_android]
    type: submit
    params:
      build_id: \${{ needs.build_android.outputs.build_id }}
  submit_ios_build:
    name: Submit iOS Build
    needs: [build_ios]
    type: submit
    params:
      build_id: \${{ needs.build_ios.outputs.build_id }}
  publish_android_update:
    name: Publish Android update
    needs: [get_android_build]
    if: \${{ needs.get_android_build.outputs.build_id }}
    type: update
    params:
      branch: production
      platform: android
  publish_ios_update:
    name: Publish iOS update
    needs: [get_ios_build]
    if: \${{ needs.get_ios_build.outputs.build_id }}
    type: update
    params:
      branch: production
      platform: ios
`;

export const workflowTemplates: WorkflowTemplate[] = [
  {
    displayName: 'Custom',
    name: WorkflowTemplateName.CUSTOM,
    defaultFileName: 'custom.yml',
    template: CUSTOM_TEMPLATE,
  },
  {
    displayName: 'Create development builds',
    name: WorkflowTemplateName.DEVELOPMENT_BUILDS,
    defaultFileName: 'development-builds.yml',
    template: DEVELOPMENT_BUILD_TEMPLATE,
  },
  {
    displayName: 'Publish preview updates',
    name: WorkflowTemplateName.PUBLISH_PREVIEW_UPDATES,
    defaultFileName: 'publish-preview-updates.yml',
    template: PUBLISH_PREVIEW_UPDATE_TEMPLATE,
  },
  {
    displayName: 'Deploy to production',
    name: WorkflowTemplateName.DEPLOY_TO_PRODUCTION,
    defaultFileName: 'deploy-to-production.yml',
    template: DEPLOY_TO_PRODUCTION_TEMPLATE,
  },
];
