# RecordSim

Small Swift library for non-exclusive iOS Simulator screen recording.

It implements one recording path:

1. Listen to SimRenderServer framebuffer callbacks.
2. Copy the live `IOSurface` immediately into an owned `CVPixelBuffer`.
3. Feed one continuous `AVAssetWriter`.
4. Emit Apple HLS/CMAF-style fragmented MP4 segments.

The output is suitable for uploading while recording. `session.json` contains
the ordered segment metadata needed to build a playlist later.

## Output

```text
session/
  init.mp4
  session.json
  segments/
    segment-000000.m4s
    segment-000001.m4s
```

`init.mp4` is the fMP4 initialization segment. Individual `.m4s` files are not
standalone MP4 files. `session.json` stores the wall-clock timestamp for the
first video frame plus the metadata needed to build a playlist: HLS version,
target duration, media sequence, `initSegment`, and the ordered `segments` array
with file path and duration for each media segment.

## CLI

```bash
swift run record-sim \
  --udid <BOOTED_SIMULATOR_UDID> \
  --output /tmp/sim-recording \
  --segment-duration 120 \
  --fps 30 \
  --bitrate 30000000 \
  --codec h264
```

For sparse 2h sessions, `--segment-duration 120` is a reasonable default: about
60 media objects plus the init segment. The recorder appends a single duplicate
hold frame near each segment boundary when the simulator is idle, so long idle
periods still produce uploadable segments without encoding idle frames at 60fps.
Use `--segment-duration 0` to write one continuous `recording.mp4` instead of
`init.mp4` plus media segments.

Frame timestamps use monotonic host time, not wall-clock time. The recorder also
probes the framebuffer seed once per second; if the surface changes without
callbacks for 5 seconds, it captures that frame and rewires the private callback
registration.

## Library

```swift
let recorder = SimulatorRecorder(
  configuration: SimulatorRecordingConfiguration(
    deviceUDID: udid,
    outputDirectory: sessionDirectory,
    segmentDuration: 120
  )
)

recorder.onSegment = { segment in
  // Enqueue upload of segment.url.
}

try recorder.start()
try recorder.waitUntilFirstFrame()
// ...
let manifest = try recorder.stop()
```

`session.json` contains the precise wall-clock time for video PTS zero. In
segmented mode it also contains the init segment and ordered media segment
file/duration entries; in single-file mode it points at `recording.mp4`.
