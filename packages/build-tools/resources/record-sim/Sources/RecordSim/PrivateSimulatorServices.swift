import Foundation
import ObjectiveC

enum XcodeDeveloperDirectory {
    static func current() -> String {
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
    }
}

enum PrivateSimulatorFrameworks {
    static func load() {
        let developerDir = XcodeDeveloperDirectory.current()
        let candidates = [
            "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
            "\(developerDir)/Library/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
            "\(developerDir)/../SharedFrameworks/SimulatorKit.framework/SimulatorKit",
            "\(developerDir)/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit",
        ]
        for path in candidates {
            _ = dlopen(path, RTLD_NOW)
        }
    }
}

enum SimulatorDeviceLookup {
    static func find(udid: String) -> NSObject? {
        guard let contextClass = NSClassFromString("SimServiceContext") as? NSObject.Type else {
            return nil
        }
        let sharedSelector = NSSelectorFromString("sharedServiceContextForDeveloperDir:error:")
        guard let context = contextClass.perform(sharedSelector, with: XcodeDeveloperDirectory.current(), with: nil)?
            .takeUnretainedValue() as? NSObject
        else {
            return nil
        }
        let deviceSetSelector = NSSelectorFromString("defaultDeviceSetWithError:")
        guard let deviceSet = context.perform(deviceSetSelector, with: nil)?
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
