import Foundation

public enum RecorderCodec: String, Codable, Sendable {
    case h264
    case hevc
}

public struct SimulatorRecordingConfiguration: Sendable {
    public var deviceUDID: String
    public var outputDirectory: URL
    public var fps: Int
    public var bitrate: Int
    public var codec: RecorderCodec
    public var segmentDuration: TimeInterval
    public var maxPendingFrames: Int
    public var overwrite: Bool

    public init(
        deviceUDID: String,
        outputDirectory: URL,
        fps: Int = 30,
        bitrate: Int = 30_000_000,
        codec: RecorderCodec = .h264,
        segmentDuration: TimeInterval = 120,
        maxPendingFrames: Int = 8,
        overwrite: Bool = true
    ) {
        self.deviceUDID = deviceUDID
        self.outputDirectory = outputDirectory
        self.fps = fps
        self.bitrate = bitrate
        self.codec = codec
        self.segmentDuration = segmentDuration
        self.maxPendingFrames = maxPendingFrames
        self.overwrite = overwrite
    }
}

public enum SegmentKind: String, Codable, Sendable {
    case initialization
    case media
}

public struct SegmentOutput: Sendable {
    public let kind: SegmentKind
    public let relativePath: String
    public let url: URL
    public let byteCount: Int
    public let durationSeconds: Double?
}

public struct MediaSegmentRecord: Codable, Sendable {
    public let file: String
    public let durationSeconds: Double
}

public struct FirstFrameWallClock: Codable, Sendable {
    public let unixMs: Int64
    public let iso8601: String
}

public struct RecordingManifest: Codable, Sendable {
    public let firstFrameWallClock: FirstFrameWallClock
    public let hlsVersion: Int?
    public let hlsTargetDurationSeconds: Int?
    public let hlsMediaSequence: Int?
    public let recording: String?
    public let initSegment: String?
    public let segments: [MediaSegmentRecord]
}
