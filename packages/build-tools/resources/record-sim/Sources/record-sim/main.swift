import Foundation
import RecordSim

struct CLIOptions {
    var udid: String?
    var output: String?
    var segmentDuration: TimeInterval = 120
    var fps = 30
    var bitrate = 30_000_000
    var codec: RecorderCodec = .h264
}

private var stopRequested: CInt = 0
private var simulatorStopped: CInt = 0

private func handleStopSignal(_ signal: CInt) {
    stopRequested = 1
}

private func isStopRequested() -> Bool {
    stopRequested != 0 || simulatorStopped != 0
}

func usage() -> String {
    """
    Usage:
      record-sim --udid <UDID> --output <session-dir> [options]

    Options:
      --segment-duration <seconds>  Target fMP4 media segment duration. Use 0 for one MP4. Default: 120
      --fps <fps>                   Expected source frame rate. Default: 30
      --bitrate <bits/sec>          AVAssetWriter average bitrate. Default: 30000000
      --codec <h264|hevc>           Video codec. Default: h264
      -h, --help                    Show this help
    """
}

func parseOptions(_ args: [String]) throws -> CLIOptions {
    var options = CLIOptions()
    var i = 0

    func next(_ flag: String) throws -> String {
        i += 1
        guard i < args.count else {
            throw NSError(domain: "record-sim", code: 2, userInfo: [NSLocalizedDescriptionKey: "Missing value for \(flag)"])
        }
        return args[i]
    }

    while i < args.count {
        let arg = args[i]
        switch arg {
        case "--udid", "-u":
            options.udid = try next(arg)
        case "--output", "--output-dir", "--out", "-o":
            options.output = try next(arg)
        case "--segment-duration":
            options.segmentDuration = Double(try next(arg)) ?? -1
        case "--fps":
            options.fps = Int(try next(arg)) ?? 0
        case "--bitrate":
            options.bitrate = Int(try next(arg)) ?? 0
        case "--codec":
            let raw = try next(arg)
            guard let codec = RecorderCodec(rawValue: raw) else {
                throw NSError(domain: "record-sim", code: 2, userInfo: [NSLocalizedDescriptionKey: "--codec must be h264 or hevc"])
            }
            options.codec = codec
        case "--help", "-h":
            print(usage())
            exit(0)
        default:
            throw NSError(domain: "record-sim", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unknown argument: \(arg)"])
        }
        i += 1
    }

    guard options.udid != nil else {
        throw NSError(domain: "record-sim", code: 2, userInfo: [NSLocalizedDescriptionKey: "Missing required --udid"])
    }
    guard options.output != nil else {
        throw NSError(domain: "record-sim", code: 2, userInfo: [NSLocalizedDescriptionKey: "Missing required --output"])
    }
    guard options.segmentDuration >= 0 else {
        throw NSError(domain: "record-sim", code: 2, userInfo: [NSLocalizedDescriptionKey: "--segment-duration must be non-negative"])
    }
    guard options.fps > 0, options.fps <= 120 else {
        throw NSError(domain: "record-sim", code: 2, userInfo: [NSLocalizedDescriptionKey: "--fps must be between 1 and 120"])
    }
    guard options.bitrate > 0 else {
        throw NSError(domain: "record-sim", code: 2, userInfo: [NSLocalizedDescriptionKey: "--bitrate must be positive"])
    }
    return options
}

do {
    signal(SIGINT, handleStopSignal)
    signal(SIGTERM, handleStopSignal)

    let options = try parseOptions(Array(CommandLine.arguments.dropFirst()))
    let configuration = SimulatorRecordingConfiguration(
        deviceUDID: options.udid!,
        outputDirectory: URL(fileURLWithPath: options.output!),
        fps: options.fps,
        bitrate: options.bitrate,
        codec: options.codec,
        segmentDuration: options.segmentDuration
    )

    let recorder = SimulatorRecorder(configuration: configuration)
    recorder.onSimulatorStopped = { state in
        simulatorStopped = 1
        fputs("[record-sim] simulator stopped state=\(state); finalizing recording\n", stderr)
    }
    recorder.onSegment = { segment in
        switch segment.kind {
        case .initialization:
            fputs("[record-sim] init \(segment.relativePath) bytes=\(segment.byteCount)\n", stderr)
        case .media:
            let duration = segment.durationSeconds ?? 0
            fputs(String(format: "[record-sim] segment %@ duration=%.3fs bytes=%d\n", segment.relativePath, duration, segment.byteCount), stderr)
        }
    }

    try recorder.start()
    try recorder.waitUntilFirstFrame()
    fputs("[record-sim] recording -> \(options.output!)\n", stderr)

    while !isStopRequested() {
        Thread.sleep(forTimeInterval: 0.1)
    }

    let manifest = try recorder.stop()
    if let recording = manifest.recording {
        fputs("[record-sim] done recording=\(recording)\n", stderr)
    } else {
        fputs("[record-sim] done segments=\(manifest.segments.count)\n", stderr)
    }
    fputs("[record-sim] manifest \(URL(fileURLWithPath: options.output!).appendingPathComponent("session.json").path)\n", stderr)
} catch {
    fputs("error: \(error.localizedDescription)\n", stderr)
    exit(1)
}
