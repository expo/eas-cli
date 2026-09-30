import CoreMedia
import Foundation

enum RecorderError {
    static func make(_ code: Int, _ message: String) -> NSError {
        NSError(
            domain: "RecordSim",
            code: code,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}

extension JSONEncoder {
    static var prettySorted: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}

func timeSeconds(_ time: CMTime) -> Double? {
    guard time.isValid, !time.isIndefinite, !time.isNegativeInfinity, !time.isPositiveInfinity else {
        return nil
    }
    return CMTimeGetSeconds(time)
}

func iso8601(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: date)
}

func unixMs(_ date: Date) -> Int64 {
    Int64((date.timeIntervalSince1970 * 1000).rounded())
}

struct MonotonicClock {
    private static let timescale: CMTimeScale = 1_000_000_000

    let startedAtUptimeNanoseconds: UInt64

    init() {
        startedAtUptimeNanoseconds = DispatchTime.now().uptimeNanoseconds
    }

    func elapsedSeconds() -> TimeInterval {
        TimeInterval(elapsedNanoseconds()) / TimeInterval(Self.timescale)
    }

    func elapsedTime() -> CMTime {
        CMTime(value: CMTimeValue(elapsedNanoseconds()), timescale: Self.timescale)
    }

    private func elapsedNanoseconds() -> UInt64 {
        DispatchTime.now().uptimeNanoseconds - startedAtUptimeNanoseconds
    }
}
