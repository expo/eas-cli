import AVFoundation
import Foundation

final class RecordingOutputWriter: NSObject, AVAssetWriterDelegate {
    private let rootDirectory: URL
    private let segmentsDirectory: URL
    let singleRecordingURL: URL
    private let stateQueue = DispatchQueue(label: "record-sim.segment-writer")
    private let notificationQueue = DispatchQueue(label: "record-sim.segment-notifications")
    private let onSegment: ((SegmentOutput) -> Void)?
    private var initSegmentPath: String?
    private var segments: [MediaSegmentRecord] = []
    private var nextMediaSegmentIndex = 0
    private var firstError: Error?

    init(rootDirectory: URL, onSegment: ((SegmentOutput) -> Void)?) {
        self.rootDirectory = rootDirectory
        self.segmentsDirectory = rootDirectory.appendingPathComponent("segments", isDirectory: true)
        self.singleRecordingURL = rootDirectory.appendingPathComponent("recording.mp4")
        self.onSegment = onSegment
        super.init()
    }

    func prepare(overwrite: Bool, segmented: Bool) throws {
        if overwrite {
            try? FileManager.default.removeItem(at: rootDirectory)
        }
        try FileManager.default.createDirectory(at: rootDirectory, withIntermediateDirectories: true)
        if segmented {
            try FileManager.default.createDirectory(at: segmentsDirectory, withIntermediateDirectories: true)
        }
    }

    var error: Error? {
        stateQueue.sync { firstError }
    }

    func assetWriter(
        _ writer: AVAssetWriter,
        didOutputSegmentData segmentData: Data,
        segmentType: AVAssetSegmentType,
        segmentReport: AVAssetSegmentReport?
    ) {
        var notification: SegmentOutput?

        stateQueue.sync {
            if firstError != nil {
                return
            }
            do {
                switch segmentType {
                case .initialization:
                    let relativePath = "init.mp4"
                    let url = rootDirectory.appendingPathComponent(relativePath)
                    try segmentData.write(to: url, options: .atomic)
                    initSegmentPath = relativePath
                    notification = SegmentOutput(
                        kind: .initialization,
                        relativePath: relativePath,
                        url: url,
                        byteCount: segmentData.count,
                        durationSeconds: nil
                    )
                case .separable:
                    let index = nextMediaSegmentIndex
                    let relativePath = String(format: "segments/segment-%06d.m4s", index)
                    let url = rootDirectory.appendingPathComponent(relativePath)
                    try segmentData.write(to: url, options: .atomic)

                    let videoReport = segmentReport?.trackReports.first(where: { $0.mediaType == .video })
                    let duration = videoReport.flatMap { timeSeconds($0.duration) } ?? 0
                    let record = MediaSegmentRecord(
                        file: relativePath,
                        durationSeconds: duration
                    )
                    nextMediaSegmentIndex += 1
                    segments.append(record)
                    notification = SegmentOutput(
                        kind: .media,
                        relativePath: relativePath,
                        url: url,
                        byteCount: segmentData.count,
                        durationSeconds: duration
                    )
                default:
                    break
                }
            } catch {
                firstError = error
            }
        }

        if let notification, let onSegment {
            notificationQueue.async {
                onSegment(notification)
            }
        }
    }

    @discardableResult
    func writeManifest(
        configuration: SimulatorRecordingConfiguration,
        firstFrameWallClock: Date
    ) throws -> RecordingManifest {
        try stateQueue.sync {
            if let firstError {
                throw firstError
            }
            let segmented = configuration.segmentDuration > 0
            if segmented, initSegmentPath == nil {
                throw RecorderError.make(50, "Missing initialization segment")
            }
            if segmented, segments.isEmpty {
                throw RecorderError.make(51, "No media segments were written")
            }
            let targetDuration = segmented
                ? max(1, Int(ceil(segments.map(\.durationSeconds).max() ?? configuration.segmentDuration)))
                : nil
            let manifest = RecordingManifest(
                firstFrameWallClock: FirstFrameWallClock(
                    unixMs: unixMs(firstFrameWallClock),
                    iso8601: iso8601(firstFrameWallClock)
                ),
                hlsVersion: segmented ? 7 : nil,
                hlsTargetDurationSeconds: targetDuration,
                hlsMediaSequence: segmented ? 0 : nil,
                recording: segmented ? nil : "recording.mp4",
                initSegment: segmented ? initSegmentPath : nil,
                segments: segments
            )
            let data = try JSONEncoder.prettySorted.encode(manifest)
            try data.write(to: rootDirectory.appendingPathComponent("session.json"), options: .atomic)
            return manifest
        }
    }
}
