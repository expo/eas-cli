# iOS signing identity failures

These diagnostics distinguish a failed import from an imported identity that
macOS does not accept. They run before the temporary build keychain is deleted,
for standard builds and custom workflows. They do not fix credentials or change
the existing validation requirement.

## Start with the import error

Read the earlier Prepare credentials messages first. Fastlane can report a native
import error and still exit successfully. No recognized import error in the logs
does not prove that import succeeded.

- **PKCS#12 MAC verification failed or unknown format:** the native importer
  rejected the package. A MAC error does not establish that the password is wrong.
  Verify the stored password and test the same package and password on the
  affected image. If the build pins an image, also test the SDK default image.
  Remove the `ios.image` override from the selected `eas.json` profile and any
  inherited profile, then run the same build profile again. This is a comparison
  test, not a guaranteed fix.
- **Private key access or item lookup failed:** macOS could not configure key
  access or find an item. Read the identity results below to check whether import
  left a usable identity. These messages alone do not establish a missing key or
  an incorrect password.
- **Other import error:** give Expo support the build URL and diagnostic code.
  The fixed message identifies a failure stage, not its cause.

## Choose the next action

An identity is a certificate and its matching private key. These fields refer
only to the expected certificate fingerprint.

| Result                                                   | What is known                                                                                         | Next action                                                                                                                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `certificatePresent=false`, `identityPresent=false`      | Neither query found the expected item.                                                                | Follow the import error above. Do not replace a certificate merely because it was not imported.                                                                                                                                      |
| `certificatePresent=true`, `identityPresent=false`       | The certificate exists, but no matching key identity was listed.                                      | Check whether the PKCS#12 package contains the matching private key. If absent, export the certificate and key together from the original keychain. If present, investigate key import using the same package on the affected image. |
| `identityPresent=true`, `codesigningValid=false`         | The identity exists but failed the queried validation policies. This is not proof of a failed import. | Check certificate dates, builder time, and `trustErrors`. Use the conditional fixes below.                                                                                                                                           |
| `codesigningValid=true`, primary check failed            | The codesigning policy accepted the identity, but the primary check did not pass.                     | Ask Expo engineering to investigate the policy difference. Test actual signing on that image before changing the validation check.                                                                                                   |
| `validIdentityQuerySucceeded=false` or a field is `null` | A command failed. Its result is unknown, not absent.                                                  | Read `queryFailures`. For EAS cloud builds, give support the build URL. For local builds, check the command and keychain access on the local machine. Do not replace credentials on this evidence.                                   |

`queryFailures` identifies the query and preserves its numeric exit status and
allowlisted signal or process error code. `ENOENT` indicates a missing executable
or required path; `EACCES`/`EPERM` indicate an access failure. A termination signal
alone does not prove a timeout. Unknown details remain `null`. Raw errors and
command output are not logged.

## Apply a fix only after its condition is confirmed

- **Wrong stored password:** correct the password for the existing package.
- **Incompatible package format:** re-export the same certificate and private
  key in a format tested on the affected macOS image. If that package imports and
  signs successfully, replacement of the certificate is unnecessary.
- **Matching private key is unavailable:** create a new key and signing
  certificate, then create or update the provisioning profiles that use it.
  First check which apps share the old certificate. Do not revoke it as a test.
- **Signing certificate expired:** replace it and update the affected profiles.
  A trust error can also refer to another certificate in the chain; check which
  certificate has the invalid dates before replacing the signing certificate.
- **Missing issuer certificate or incorrect builder trust configuration:** repair
  the issuer chain or configuration on the builder. Installing an intermediate
  on the customer's laptop does not repair an EAS cloud image. Select the
  intermediate from the actual issuer, not a fixed WWDR version. Escalate cloud
  image changes to Expo engineering; do not bypass trust validation.
- **Incorrect builder clock:** correct the clock on the affected machine.
- **Same credentials pass on the SDK default image:** use that configuration as
  a mitigation and retain both build URLs for investigation. This does not prove
  which image component caused the failure.

## Confirm recovery and report the limits

Confirm with a complete signed build. An identity listing, including
`codesigningValid=true`, does not prove that codesign can access the private key.

Record the failing and passing build URLs, resolved image versions, and what
changed. The same certificate fingerprint does not prove that the PKCS#12 bytes
or password stayed the same. To isolate image compatibility, test the same
package and password on both images. Report successful recovery separately from
an established root cause.

Keep passwords, PKCS#12 files, private keys, and raw Fastlane process errors out
of tickets and public logs. Extra queries run only after failure and each has a
10-second timeout. These diagnostics do not modify trust or retry builds.
