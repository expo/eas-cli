import Foundation
import ObjectiveC

enum XcodeDeveloperDirectory {
    static let current: String = {
        if let developerDir = ProcessInfo.processInfo.environment["DEVELOPER_DIR"],
            !developerDir.isEmpty
        {
            return developerDir
        }

        let fallback = "/Applications/Xcode.app/Contents/Developer"
        let pipe = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select")
        process.arguments = ["-p"]
        process.standardOutput = pipe
        do {
            try process.run()
        } catch {
            return fallback
        }
        process.waitUntilExit()
        return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? fallback
    }()
}

enum PrivateSimulatorFrameworks {
    static func load() throws {
        try loadResult.get()
    }

    private static let loadResult: Result<Void, Error> = {
        let developerDir = XcodeDeveloperDirectory.current
        let candidates = [
            "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
            "\(developerDir)/Library/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
            "\(developerDir)/../SharedFrameworks/SimulatorKit.framework/SimulatorKit",
            "\(developerDir)/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit",
        ]
        var failures: [String] = []
        for path in candidates {
            if dlopen(path, RTLD_NOW) == nil {
                let message = dlerror().map { String(cString: $0) } ?? "unknown error"
                failures.append("\(path): \(message)")
            }
        }
        guard NSClassFromString("SimServiceContext") != nil else {
            let tried = candidates.joined(separator: ", ")
            let errors = failures.isEmpty ? "no dlopen errors" : failures.joined(separator: "; ")
            return .failure(
                RecorderError.make(
                    8,
                    "Failed to load CoreSimulator/SimulatorKit (tried: \(tried); errors: \(errors))"
                )
            )
        }
        return .success(())
    }()
}

enum SimulatorDeviceLookup {
    private static let context: NSObject? = {
        guard let contextClass = NSClassFromString("SimServiceContext") as? NSObject.Type else {
            return nil
        }
        let sharedSelector = NSSelectorFromString("sharedServiceContextForDeveloperDir:error:")
        return contextClass.perform(
            sharedSelector, with: XcodeDeveloperDirectory.current, with: nil)?
            .takeUnretainedValue() as? NSObject
    }()

    static func find(udid: String) -> NSObject? {
        guard let context else {
            return nil
        }
        let deviceSetSelector = NSSelectorFromString("defaultDeviceSetWithError:")
        guard
            let deviceSet = context.perform(deviceSetSelector, with: nil)?
                .takeUnretainedValue() as? NSObject
        else {
            return nil
        }
        guard let devices = deviceSet.value(forKey: "devices") as? [NSObject] else {
            return nil
        }
        return devices.first {
            ($0.value(forKey: "UDID") as? NSUUID)?.uuidString == udid
        }
    }

    static func stateString(udid: String) -> String? {
        find(udid: udid)?.value(forKey: "stateString") as? String
    }
}
