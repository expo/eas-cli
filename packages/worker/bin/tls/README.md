# Temporary eMudhra trust policy

The packaged startup shell applies this policy before the normal worker starts.
It uses the included CA bundle for Node, OpenSSL clients, curl, and Requests.
It adds the affected certificate fingerprints to Java blocklists. Only that
Java update needs root; the worker continues as its original user.

No startup download or image rebuild is required. The tarball must include
`bin/tls/empty/.gitkeep`: this directory replaces the system hashed CA directory.
Development and test environments skip the policy. Staging and production stop
startup if setup fails or inherited Node trust options conflict.

## Pinned data

`ca.pem` is the Mozilla CA bundle from https://curl.se/ca/cacert.pem, retrieved
on 2026-10-22. Its header identifies the source snapshot as 2026-10-20.
Source and bundled SHA-256:
`796f1389bfea13c0ed78f663b765baaff54a508e5483786bd6ece73c5e3e3cbe`.
The bundle already excludes all four affected root public keys. No certificates
were removed from the downloaded file. Original source comments are retained.

`blocked-certs.txt` contains SHA-256 fingerprints for the four roots and 16
intermediate certificates published at:

- https://emudhra.we-have-a-problem.com/roots.json
- https://emudhra.we-have-a-problem.com/impacted-intermediates.json

The test fixtures retain those source records and the 12 published TLS chains
from https://emudhra.we-have-a-problem.com/chains.zip. All were retrieved on
2026-10-22. No private keys are included. Changes to these files are security
policy changes and need review.

## Verification and limits

`yarn workspace @expo/worker test:startup` checks all 12 chains, a real local
Node HTTPS request through the packaged entry point, setup failure, and Java
blocklist preservation. Tests do not use real sudo or change the host JDKs.
`test:unit` also checks trust-variable inheritance into the job environment.

Before deployment, run the packaged worker on every supported Linux and macOS
image. Verify passwordless `sudo -n`, process shutdown, the worker connection,
all installed Java versions, Ruby, curl, Python, and valid HTTPS controls.
OpenSSL 3 is required for the offline chain tests, not for the worker startup.

This is a mitigation for the default worker and inherited job trust settings.
It does not cover:

- The earlier worker-tarball download or host-side network requests.
- Native macOS Keychain clients or a curl build that uses another trust backend.
- Jobs that replace trust settings, use their own CA file, or install another JDK.
- Separate container trust stores or JDKs outside the standard scanned directories.

The shared bundle can omit image-specific roots. Removing AAA and emSign roots
can break valid services. Review these compatibility effects before rollout.
Java file changes are tested; Java runtime rejection on each image is still
required. A partial setup failure must discard the VM. Replace existing workers
to apply or roll back the policy; do not remove it from a running worker.
