# Session ownership of Android recording

The EAS session owns the local Device Hub process and recording. A preview owns
only its ngrok tunnel. The four remote-session build functions use this lifetime:

```ts
const host = await startDeviceSessionHostAsync(ctx, options);
try {
  const preview = await host.openPreviewAsync({ baseDomain });
  await uploadRemoteSessionConfigAsync({
    ...config,
    remoteConfig: { previewUrl: preview.previewUrl },
  });
  await waitForDeviceRunSessionStoppedAsync(waitOptions);
} finally {
  await host.finishAsync();
}
```

`DeviceSessionHost` exposes `openPreviewAsync({ baseDomain })` and `finishAsync()`.
`DeviceWebPreview` exposes `previewUrl`, an optional `previewToken`, and
`closeAsync()`. To replace a preview, await its close before opening another.
Concurrent opens share one preview. Closing an old handle cannot close its replacement.

## Why the owner changed

The PoC commits, Device Hub `67fb00a` and EAS CLI `bfac6025`, reused the canonical
H.264 capture rather than starting another encoder. The four EAS callers held a
preview handle until the remote session ended, so preview-owned cleanup worked
for that first implementation. It also meant that replacing a preview ended recording.

The follow-up keeps capture in the same process and makes the longer session
lifetime explicit. No ngrok tunnel is needed to start the host or its recording.
Closing a tunnel does not finalize, upload, or restart capture.

This rationale comes from those unpublished commits, their callers, and the PoC
discussion. No external incident, tracker entry, or production behavior is claimed
as evidence for the original choice.

## Ownership and dependencies

`utils/deviceSessionHost.ts` owns launch, readiness, preview tunnels, and terminal
cleanup. `utils/remoteDeviceRunSession.ts` retains process, tunnel, and remote
session helpers. It does not import the host or the uploader.

`utils/deviceRunSessionScreenRecordings.ts` owns descriptor validation and artifact
upload. It receives an explicit session ID and imports neither the host nor a build
function. The upload build function remains an adapter for the existing iOS workflow.

On Device Hub, `AndroidSession` owns recording startup, result-list publication,
and shutdown. The serve-emu router still owns the recorder bound to the canonical
capture generation. Packet delivery, MP4 muxing, CLI flags, authenticated stop,
and the `recordings.json` contract are unchanged.

## Cleanup and failure policy

`finishAsync()` is terminal and returns the same promise on repeated calls. It
closes the preview, requests authenticated recording finalization, stops the local
process, and uploads the result. New preview opens reject after finalization starts.
An in-flight tunnel open is drained before cleanup completes.

Recording finalization has a 60-second timeout. The process gets a 70-second
shutdown allowance when recording is enabled. Finalization and upload failures
remain warnings, and cleanup continues after a tunnel-close or process-stop failure.
Artifacts remain on disk for diagnosis.

Failed host startup runs cleanup before rethrowing the startup error. Failed tunnel
startup leaves the host available for retry. All four callers finish the host if
they abandon the session, including failures while publishing the preview or config.

Darwin uses the same host interface for serve-sim, including its required preview
token. Existing iOS recording start and finish build steps remain independent.

## Design alternatives

The design comparison selected the session-owned host, candidate A. The separate
cross-judge reached the same decision. Candidate C supplied the reconnect and
failure test cases. Candidates B and C reinforced the scoped `AndroidSession`
object instead of a broader Hub runtime rewrite.

A preview-plus-recording bundle was rejected because its preview stop still killed
the shared host. Exposing separate recording, process, and tunnel teardown handles
was rejected because every caller would need to remember their cleanup order.
Compatibility aliases for the old launcher were removed with their callers.

This design accepts that a Hub process crash ends recording. It isolates recording
from preview tunnels, not from the process that owns capture. A separate recorder
process, rotation recovery, segment stitching, and multi-device capture remain out
of scope.

## Verification

The host tests cover no-preview recording, close and reopen, stale handles, concurrent
finish, an in-flight open, tunnel failure, and failed host startup. Orchestration
tests cover normal completion and preview, config, and wait failures for all four
callers. The existing uploader tests retain iOS and Android artifact coverage.

Device Hub's live verifier connects and disconnects a viewer twice, then verifies
the MP4, monotonic timestamps, and elapsed duration. It covers gRPC endpoint stop,
gRPC signal stop, and scrcpy endpoint stop. Hosted EAS upload and website playback
still need an end-to-end run with published or locally supplied branch builds.
