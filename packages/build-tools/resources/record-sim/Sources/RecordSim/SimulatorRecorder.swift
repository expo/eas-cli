import AVFoundation
import CoreVideo
import Foundation
import IOSurface
import UniformTypeIdentifiers

public final class SimulatorRecorder {
    public var onSegment: ((SegmentOutput) -> Void)?
    public var onSimulatorStopped: ((String) -> Void)?

    private static let callbackStalenessTimeout: TimeInterval = 5
    private static let firstFrameRewireInterval: TimeInterval = 1
    private let configuration: SimulatorRecordingConfiguration
    private let callbackQueue = DispatchQueue(label: "record-sim.frame-callbacks", qos: .userInteractive)
    private let writerQueue = DispatchQueue(label: "record-sim.asset-writer", qos: .userInitiated)
    private let eventQueue = DispatchQueue(label: "record-sim.events", qos: .utility)
    private let pendingLock = NSLock()
    private var pendingFrames = 0
    private var displaySource: FramebufferDisplaySource?
    private var outputWriter: RecordingOutputWriter?
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var boundaryTimer: DispatchSourceTimer?
    private var monotonicClock = MonotonicClock()
    private var firstAcceptedCaptureTime: CMTime?
    private var firstAcceptedWallClock: Date?
    private var lastPTS: CMTime?
    private var lastSeed: UInt32?
    private var lastFrameCallbackElapsed: TimeInterval?
    private var lastFirstFrameRewireElapsed: TimeInterval = 0
    private var lastAppendedPixelBuffer: CVPixelBuffer?
    private var nextBoundaryElapsed: TimeInterval = 0
    private var simulatorStoppedReason: String?
    private var stopped = false
    private var firstFrameReady = false
    private let firstFrameSemaphore = DispatchSemaphore(value: 0)
    private var firstError: Error?

    public init(configuration: SimulatorRecordingConfiguration) {
        self.configuration = configuration
    }

    public func start() throws {
        try validateConfiguration()

        let outputWriter = RecordingOutputWriter(rootDirectory: configuration.outputDirectory, onSegment: { [weak self] segment in
            self?.onSegment?(segment)
        })
        try outputWriter.prepare(overwrite: configuration.overwrite, segmented: configuration.segmentDuration > 0)
        self.outputWriter = outputWriter

        monotonicClock = MonotonicClock()
        nextBoundaryElapsed = configuration.segmentDuration
        lastFirstFrameRewireElapsed = 0
        stopped = false

        let source = FramebufferDisplaySource(
            deviceUDID: configuration.deviceUDID,
            callbackQueue: callbackQueue,
            onFrame: { [weak self] in
                self?.captureFrame(force: false, reason: .callback)
            },
            onSurfaceChange: { [weak self] in
                self?.captureFrame(force: true, reason: .surfaceChange)
            }
        )
        try source.start()
        displaySource = source

        startBoundaryTimer()
    }

    public func waitUntilFirstFrame(timeoutSeconds: TimeInterval = 15) throws {
        let alreadyReady = try writerQueue.sync {
            if let firstError {
                throw firstError
            }
            return firstFrameReady
        }
        if alreadyReady {
            return
        }
        if firstFrameSemaphore.wait(timeout: .now() + timeoutSeconds) == .timedOut {
            throw RecorderError.make(20, "Timed out waiting for first frame")
        }
        try writerQueue.sync {
            if let firstError {
                throw firstError
            }
            if !firstFrameReady {
                throw RecorderError.make(21, "Recorder stopped before first frame")
            }
        }
    }

    public func simulatorStopReason() -> String? {
        callbackQueue.sync {
            simulatorStoppedReason
        }
    }

    @discardableResult
    public func stop() throws -> RecordingManifest {
        callbackQueue.sync {
            stopped = true
            boundaryTimer?.cancel()
            boundaryTimer = nil
            displaySource?.stop()
            displaySource = nil
        }

        return try writerQueue.sync {
            if let firstError {
                throw firstError
            }
            guard let writer, let input, let outputWriter else {
                let error = RecorderError.make(22, "No frames were captured")
                firstError = error
                signalFirstFrameReadyIfNeeded()
                throw error
            }
            try appendTailFrameIfNeeded(finalPTS: monotonicClock.elapsedTime())
            input.markAsFinished()
            let semaphore = DispatchSemaphore(value: 0)
            writer.finishWriting {
                semaphore.signal()
            }
            if semaphore.wait(timeout: .now() + 60) == .timedOut {
                throw RecorderError.make(23, "Timed out finishing AVAssetWriter")
            }
            if writer.status == .failed {
                throw writer.error ?? RecorderError.make(24, "AVAssetWriter failed")
            }
            if let error = outputWriter.error {
                throw error
            }
            guard let firstAcceptedWallClock else {
                throw RecorderError.make(25, "Missing first frame wall-clock timestamp")
            }
            return try outputWriter.writeManifest(
                configuration: configuration,
                firstFrameWallClock: firstAcceptedWallClock
            )
        }
    }

    private enum CaptureReason {
        case callback
        case surfaceChange
        case boundary
        case healthProbe
    }

    private func validateConfiguration() throws {
        guard !configuration.deviceUDID.isEmpty else {
            throw RecorderError.make(30, "deviceUDID must not be empty")
        }
        guard configuration.fps > 0, configuration.fps <= 120 else {
            throw RecorderError.make(31, "fps must be between 1 and 120")
        }
        guard configuration.bitrate > 0 else {
            throw RecorderError.make(32, "bitrate must be positive")
        }
        guard configuration.segmentDuration >= 0 else {
            throw RecorderError.make(33, "segmentDuration must be non-negative")
        }
        guard configuration.maxPendingFrames > 0 else {
            throw RecorderError.make(34, "maxPendingFrames must be positive")
        }
    }

    private func startBoundaryTimer() {
        let timer = DispatchSource.makeTimerSource(queue: callbackQueue)
        timer.schedule(deadline: .now() + 1, repeating: 1, leeway: .milliseconds(100))
        timer.setEventHandler { [weak self] in
            self?.probeSimulatorState()
            self?.probeFramebufferHealth()
            self?.appendBoundaryFrameIfNeeded()
        }
        timer.resume()
        boundaryTimer = timer
    }

    private func appendBoundaryFrameIfNeeded() {
        if stopped {
            return
        }
        guard configuration.segmentDuration > 0 else {
            return
        }
        let currentPTSSeconds = writerQueue.sync { () -> TimeInterval? in
            guard firstAcceptedCaptureTime != nil else {
                return nil
            }
            return CMTimeGetSeconds(normalizedPresentationTime(for: monotonicClock.elapsedTime()))
        }
        guard let currentPTSSeconds, currentPTSSeconds >= nextBoundaryElapsed else {
            return
        }

        let boundary = nextBoundaryElapsed

        let didAppendBoundaryFrame = writerQueue.sync { () -> Bool in
            guard let lastPTS else {
                return false
            }
            if CMTimeGetSeconds(lastPTS) >= boundary {
                return true
            }

            do {
                let boundaryPTS = CMTime(seconds: boundary, preferredTimescale: 1_000_000_000)
                return try appendHeldFrame(at: boundaryPTS)
            } catch {
                firstError = error
                signalFirstFrameReadyIfNeeded()
                return false
            }
        }
        if didAppendBoundaryFrame {
            nextBoundaryElapsed = boundary + configuration.segmentDuration
        }
    }

    private func captureFrame(force: Bool, reason: CaptureReason) {
        if stopped {
            return
        }
        if reason == .callback {
            lastFrameCallbackElapsed = monotonicClock.elapsedSeconds()
        }
        guard let snapshot = displaySource?.surfaceSnapshot() else {
            return
        }
        let surface = snapshot.surface
        let surfaceWidth = snapshot.width
        let surfaceHeight = snapshot.height
        guard surfaceWidth > 0, surfaceHeight > 0 else {
            return
        }

        let seed = snapshot.seed
        if !force, let lastSeed, lastSeed == seed {
            return
        }

        guard reservePendingFrame() else {
            return
        }

        let capturedAt = monotonicClock.elapsedTime()
        let capturedAtWallClock = Date()
        do {
            let pixelBuffer = try copySurfaceToOwnedPixelBuffer(
                surface,
                width: surfaceWidth,
                height: surfaceHeight
            )
            lastSeed = seed
            appendOwned(
                pixelBuffer: pixelBuffer,
                capturedAt: capturedAt,
                capturedAtWallClock: capturedAtWallClock
            )
        } catch {
            releasePendingFrame()
            writerQueue.async {
                self.firstError = error
                self.signalFirstFrameReadyIfNeeded()
            }
        }
    }

    private func probeFramebufferHealth() {
        guard !stopped, let displaySource else {
            return
        }
        let elapsed = monotonicClock.elapsedSeconds()
        if !isFirstFrameReady(),
           elapsed - lastFirstFrameRewireElapsed >= Self.firstFrameRewireInterval {
            lastFirstFrameRewireElapsed = elapsed
            rewireFramebuffer(reason: "waiting for first frame")
            captureFrame(force: true, reason: .healthProbe)
            return
        }

        guard let snapshot = displaySource.surfaceSnapshot(),
              snapshot.width > 0,
              snapshot.height > 0
        else {
            rewireFramebuffer(reason: "missing framebuffer surface")
            return
        }

        let observedSeed = snapshot.seed
        guard let lastSeed, observedSeed != lastSeed else {
            return
        }

        let lastCallback = lastFrameCallbackElapsed ?? 0
        if elapsed - lastCallback >= Self.callbackStalenessTimeout {
            captureFrame(force: false, reason: .healthProbe)
            rewireFramebuffer(reason: "framebuffer changed without callbacks")
        }
    }

    private func probeSimulatorState() {
        guard !stopped, simulatorStoppedReason == nil else {
            return
        }
        let state = SimulatorDeviceLookup.stateString(udid: configuration.deviceUDID) ?? "missing"
        guard state != "Booted" else {
            return
        }
        simulatorStoppedReason = state
        let error = RecorderError.make(26, "Simulator stopped before first frame (state: \(state))")
        writerQueue.async {
            if self.firstError == nil, !self.firstFrameReady {
                self.firstError = error
                self.signalFirstFrameReadyIfNeeded()
            }
        }
        let onSimulatorStopped = onSimulatorStopped
        eventQueue.async {
            onSimulatorStopped?(state)
        }
    }

    private func rewireFramebuffer(reason: String) {
        guard let displaySource else {
            return
        }
        do {
            try displaySource.rewireFramebuffer()
        } catch {
            writerQueue.async {
                self.firstError = error
                self.signalFirstFrameReadyIfNeeded()
            }
        }
    }

    private func reservePendingFrame() -> Bool {
        pendingLock.lock()
        defer { pendingLock.unlock() }
        if pendingFrames >= configuration.maxPendingFrames {
            return false
        }
        pendingFrames += 1
        return true
    }

    private func releasePendingFrame() {
        pendingLock.lock()
        pendingFrames = max(0, pendingFrames - 1)
        pendingLock.unlock()
    }

    private func copySurfaceToOwnedPixelBuffer(
        _ surface: IOSurface,
        width: Int,
        height: Int
    ) throws -> CVPixelBuffer {
        let pool = try writerQueue.sync {
            if let firstError {
                throw firstError
            }
            if writer == nil {
                try startWriter(width: width, height: height)
            }
            guard let pool = adaptor?.pixelBufferPool else {
                throw RecorderError.make(40, "AVAssetWriter pixel buffer pool is unavailable")
            }
            return pool
        }

        var output: CVPixelBuffer?
        let status = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &output)
        guard status == kCVReturnSuccess, let destination = output else {
            throw RecorderError.make(41, "Failed to allocate pixel buffer from pool: \(status)")
        }

        CVPixelBufferLockBaseAddress(destination, [])
        IOSurfaceLock(surface, .readOnly, nil)
        defer {
            IOSurfaceUnlock(surface, .readOnly, nil)
            CVPixelBufferUnlockBaseAddress(destination, [])
        }

        guard let destinationAddress = CVPixelBufferGetBaseAddress(destination) else {
            throw RecorderError.make(42, "Pixel buffer has no base address")
        }
        let sourceAddress = IOSurfaceGetBaseAddress(surface)
        let sourceStride = IOSurfaceGetBytesPerRow(surface)
        let destinationStride = CVPixelBufferGetBytesPerRow(destination)
        let copyBytes = min(width * 4, sourceStride, destinationStride)
        for row in 0..<height {
            memcpy(
                destinationAddress.advanced(by: row * destinationStride),
                sourceAddress.advanced(by: row * sourceStride),
                copyBytes
            )
        }
        return destination
    }

    private func appendOwned(
        pixelBuffer: CVPixelBuffer,
        capturedAt: CMTime,
        capturedAtWallClock: Date
    ) {
        writerQueue.async {
            defer { self.releasePendingFrame() }
            if self.firstError != nil {
                return
            }
            do {
                try self.appendOnWriterQueue(
                    pixelBuffer: pixelBuffer,
                    capturedAt: capturedAt,
                    capturedAtWallClock: capturedAtWallClock
                )
            } catch {
                self.firstError = error
                self.signalFirstFrameReadyIfNeeded()
            }
        }
    }

    private func appendOnWriterQueue(
        pixelBuffer: CVPixelBuffer,
        capturedAt: CMTime,
        capturedAtWallClock: Date
    ) throws {
        guard let writer, let input, let adaptor else {
            throw RecorderError.make(43, "AVAssetWriter is not initialized")
        }
        let isFirstFrame = firstAcceptedCaptureTime == nil
        let pts = isFirstFrame ? .zero : normalizedPresentationTime(for: capturedAt)
        if let lastPTS, CMTimeCompare(pts, lastPTS) <= 0 {
            return
        }
        guard try appendPendingBoundaryFrames(before: pts) else {
            return
        }
        guard input.isReadyForMoreMediaData else {
            return
        }
        if !adaptor.append(pixelBuffer, withPresentationTime: pts) {
            throw writer.error ?? RecorderError.make(44, "Failed to append pixel buffer")
        }
        if isFirstFrame {
            firstAcceptedCaptureTime = capturedAt
            firstAcceptedWallClock = capturedAtWallClock
        }
        lastPTS = pts
        lastAppendedPixelBuffer = pixelBuffer
        signalFirstFrameReadyIfNeeded()
    }

    private func appendTailFrameIfNeeded(finalPTS: CMTime) throws {
        let deadline = Date().addingTimeInterval(5)
        while true {
            if try appendTailFrame(finalPTS: finalPTS) {
                return
            }
            if Date() >= deadline {
                throw RecorderError.make(45, "Timed out waiting to append tail frame")
            }
            Thread.sleep(forTimeInterval: 0.05)
        }
    }

    private func appendTailFrame(finalPTS: CMTime) throws -> Bool {
        let pts = normalizedPresentationTime(for: finalPTS)
        return try appendHeldFrame(at: pts)
    }

    private func appendPendingBoundaryFrames(before pts: CMTime) throws -> Bool {
        guard configuration.segmentDuration > 0,
              firstAcceptedCaptureTime != nil
        else {
            return true
        }

        while CMTimeGetSeconds(pts) > nextBoundaryElapsed {
            if let lastPTS, CMTimeGetSeconds(lastPTS) >= nextBoundaryElapsed {
                nextBoundaryElapsed += configuration.segmentDuration
                continue
            }

            let boundaryPTS = CMTime(seconds: nextBoundaryElapsed, preferredTimescale: 1_000_000_000)
            guard try appendHeldFrame(at: boundaryPTS) else {
                return false
            }
            nextBoundaryElapsed += configuration.segmentDuration
        }
        return true
    }

    private func appendHeldFrame(at pts: CMTime) throws -> Bool {
        guard let input,
              let adaptor,
              let lastPTS,
              let lastAppendedPixelBuffer
        else {
            return true
        }
        if CMTimeCompare(pts, lastPTS) <= 0 {
            return true
        }
        guard input.isReadyForMoreMediaData else {
            return false
        }
        if !adaptor.append(lastAppendedPixelBuffer, withPresentationTime: pts) {
            throw writer?.error ?? RecorderError.make(45, "Failed to append held frame")
        }
        self.lastPTS = pts
        return true
    }

    private func normalizedPresentationTime(for capturedAt: CMTime) -> CMTime {
        let start = firstAcceptedCaptureTime ?? capturedAt
        return CMTimeSubtract(capturedAt, start)
    }

    private func startWriter(width: Int, height: Int) throws {
        guard let outputWriter else {
            throw RecorderError.make(46, "Missing output writer")
        }

        let writer: AVAssetWriter
        if configuration.segmentDuration > 0 {
            writer = AVAssetWriter(contentType: .mpeg4Movie)
            writer.delegate = outputWriter
            writer.outputFileTypeProfile = .mpeg4AppleHLS
            writer.preferredOutputSegmentInterval = CMTime(
                seconds: configuration.segmentDuration,
                preferredTimescale: 600
            )
        } else {
            writer = try AVAssetWriter(outputURL: outputWriter.singleRecordingURL, fileType: .mp4)
        }
        writer.initialSegmentStartTime = .zero

        let input = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: assetWriterSettings(width: width, height: height)
        )
        input.expectsMediaDataInRealTime = true

        let attributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: attributes
        )

        guard writer.canAdd(input) else {
            throw RecorderError.make(47, "AVAssetWriter cannot add video input")
        }
        writer.add(input)
        guard writer.startWriting() else {
            throw writer.error ?? RecorderError.make(48, "AVAssetWriter failed to start")
        }
        writer.startSession(atSourceTime: .zero)

        self.writer = writer
        self.input = input
        self.adaptor = adaptor
    }

    private func assetWriterSettings(width: Int, height: Int) -> [String: Any] {
        let codecType: AVVideoCodecType = configuration.codec == .hevc ? .hevc : .h264
        var compression: [String: Any] = [
            AVVideoAverageBitRateKey: configuration.bitrate,
            AVVideoExpectedSourceFrameRateKey: configuration.fps,
            AVVideoAllowFrameReorderingKey: true,
        ]
        if configuration.segmentDuration > 0 {
            compression[AVVideoMaxKeyFrameIntervalKey] = max(
                1,
                Int((configuration.segmentDuration * Double(configuration.fps)).rounded())
            )
        }
        if configuration.codec == .h264 {
            compression[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel
        }
        return [
            AVVideoCodecKey: codecType,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: compression,
        ]
    }

    private func signalFirstFrameReadyIfNeeded() {
        if firstFrameReady {
            return
        }
        firstFrameReady = true
        firstFrameSemaphore.signal()
    }

    private func isFirstFrameReady() -> Bool {
        writerQueue.sync {
            firstFrameReady
        }
    }
}
