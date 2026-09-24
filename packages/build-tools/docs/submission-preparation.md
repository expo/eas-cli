# Submission preparation without project dependencies

`eas/prepare_submission` resolves a submit profile and existing credentials without
loading Expo app config, config plugins, native project files, or the project's
`node_modules`. Its dependencies ship with the worker. Public `eas submit` and the
legacy `submit:internal` command remain available.

The function takes `build_id`, `platform` (`ios` or `android`), and
`application_identifier`. The identifier comes from the downloaded artifact.
`profile` and `groups` are optional. An explicit profile must exist. Without an
explicit profile, the build profile is tried first, then the default submit profile.
As in the legacy workflow, a profile's `bundleIdentifier` or `applicationId` takes
precedence for credential lookup. The uploaded artifact is unchanged.

Use `eas/read_ipa_info` to obtain the iOS identifier and versions. Android callers
can retain their APK/AAB metadata step. Checkout is still required for `eas.json`,
local credential files, and hooks; dependency installation is not required.

```yaml
steps:
  - uses: eas/checkout
  - uses: eas/download_build
    id: download
    with:
      build_id: ${{ inputs.build_id }}
      extensions: [ipa]
  - uses: eas/read_ipa_info
    id: ipa
    with:
      ipa_path: ${{ steps.download.outputs.artifact_path }}
  - uses: eas/prepare_submission
    id: preparation
    with:
      build_id: ${{ inputs.build_id }}
      platform: ios
      profile: production
      application_identifier: ${{ steps.ipa.outputs.bundle_identifier }}
  # Upload with pilot or eas/upload_to_asc using the prepared settings.
  - uses: eas/cleanup_submission
    if: ${{ always() }}
    with:
      credentials_directory: ${{ steps.preparation.outputs.credentials_directory || '' }}
```

The function uses the worker's authenticated GraphQL client and checks that the
build belongs to the job's project and platform before retrieving credentials.
It does not create credentials interactively. Missing credentials produce an
actionable error.

Public outputs include `asc_app_identifier`, `apple_id_username`, `groups`,
`track`, `release_status`, `rollout`, `changes_not_sent_for_review`, and
`is_verbose_fastlane_enabled`. Secret outputs are **paths**, not secret contents:
`json_key_path`, `apple_app_specific_password_path`, and
`google_service_account_key_path`. Files have mode 0600 and are stored in a private
directory outside the checkout. Read the password file into the upload process's
environment; do not print it or pass it as a command argument. Always schedule
`eas/cleanup_submission` after upload and submission recording. Preparation errors
remove partial files immediately. Abrupt worker termination still relies on worker
environment teardown.

For iOS, `ascAppId` is required. Team and individual ASC keys and Apple ID
app-specific passwords are supported. Best-effort internal TestFlight group setup
uses environment or stored ASC credentials, independently of the upload credentials.
Its failure does not prevent upload. Fastlane version support and the upload image
remain the caller's responsibility.

## Release order

1. Publish the updated eas-json and build-tools packages and the worker that includes
   them. They must be released together: build-tools uses the new explicit submit
   profile environment argument.
2. Verify function registration on every target worker runtime, on macOS and Linux,
   including jobs that select older SDK images. An OS image version alone does not
   establish which worker package is loaded.
3. Deploy the Universe workflow changes with their rollout gate disabled.
4. Run internal smoke submissions without `node_modules`, then enable the gate for
   a small set of accounts. Preserve explicit image selection and install hooks.
5. Expand only after checking upload success, credentials failures, TestFlight
   distribution, and job duration. Roll back by disabling the Universe gate.

Do not remove `submit:internal` until all callers and supported rollback paths have
migrated. Removing project dependencies does not upgrade fastlane.
