# iOS certificate import diagnostics

These diagnostics run before the build keychain is removed. They apply to standard
builds and custom workflows. They do not change the valid-identity requirement.

## Read the failure

First check the certificate import messages. Fastlane can print a macOS import
error and still exit with status zero. Only known error categories are logged;
raw output and process errors can contain passwords or private key attributes.
An absence of import warnings does not prove that the import succeeded.

Then check `iOS signing identity diagnostics`:

| Certificate present | Identity present | Next check                                                                                            |
| ------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `false`             | `false`          | Check the import messages, PKCS#12 password, and export format.                                       |
| `true`              | `false`          | Check whether the PKCS#12 file contains the matching private key and whether macOS imported that key. |
| `true`              | `true`           | Check the certificate dates, issuer chain, and trust configuration on the build machine.              |
| `null`              | any              | The certificate query failed; do not infer that the certificate is absent.                            |
| any                 | `null`           | The identity query failed; do not infer that the private key is absent.                               |

`identityPresent` uses the expected certificate fingerprint. It does not prove
that codesign can use the key without an access error. `codesigningValid` is a
separate macOS policy probe, not a signing test. It never overrides the existing
basic-policy check. `trustErrors` contains symbolic errors for the expected
identity only. `validIdentityQuerySucceeded=false` means the original query
failed, rather than returning a list without the expected identity.

A PKCS#12 MAC verification error does not prove that the password is wrong.
An export format that macOS cannot read can produce the same error. Verify the
password and format before asking a customer to replace a certificate. A trust
failure can come from certificate data or the build machine's trust setup.
Do not assign the cause to either side from the old generic error alone.

## Follow up

1. Get the new Prepare credentials logs from an affected build, including its
   image and build-tools version.
2. Use the table to choose the next test. For an import failure, test the same
   PKCS#12 file and password in a disposable keychain on the affected image.
   For a trust failure, compare the certificate dates and issuer chain with
   the certificates and trust configuration on that image.
3. If a compatible PKCS#12 export fixes the import, keep the same certificate
   and private key where possible. Do not revoke a certificate as a diagnostic
   step. A new certificate changes more than the export format.
4. Confirm the fix with an actual signed build. An identity listing alone does
   not confirm access to the private key or successful signing.

Keep passwords, PKCS#12 files, private keys, and raw Fastlane process errors out
of tickets and public logs. These probes do not modify trust settings or retry
customer builds. Each extra query has a 10-second timeout and runs only on failure. Unknown errors remain possible because raw output is not retained.
