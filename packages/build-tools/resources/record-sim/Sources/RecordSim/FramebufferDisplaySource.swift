import Foundation
import IOSurface
import ObjectiveC

final class FramebufferDisplaySource {
    struct SurfaceSnapshot {
        let surface: IOSurface
        let width: Int
        let height: Int
        let seed: UInt32
        /// Clockwise rotation in degrees (0, 90, 180, or 270) that shows the panel upright.
        let rotation: Int

        var uprightWidth: Int { rotation % 180 == 0 ? width : height }
        var uprightHeight: Int { rotation % 180 == 0 ? height : width }
    }

    /// The panels to record, in a stable order. A nil entry is a panel that has no surface yet.
    struct FrameSnapshot {
        let panels: [SurfaceSnapshot?]

        var seeds: [UInt32?] { panels.map { $0?.seed } }
    }

    private let deviceUDID: String
    private let callbackQueue: DispatchQueue
    private let onFrame: () -> Void
    private let onSurfaceChange: () -> Void
    private var descriptors: [NSObject] = []
    /// Integrated panels in screen ID order, which puts the iPhone Duo front panel first.
    private var integratedPanels: [(descriptor: NSObject, rotation: Int)] = []
    /// Mounting rotation of each integrated panel from the device profile, by screen ID.
    private var nativeRotations: [UInt32: Int] = [:]
    private var callbackUUIDs: [ObjectIdentifier: NSUUID] = [:]
    private var retainedBlocks: [AnyObject] = []
    private var ioClient: NSObject?

    init(
        deviceUDID: String,
        callbackQueue: DispatchQueue,
        onFrame: @escaping () -> Void,
        onSurfaceChange: @escaping () -> Void
    ) {
        self.deviceUDID = deviceUDID
        self.callbackQueue = callbackQueue
        self.onFrame = onFrame
        self.onSurfaceChange = onSurfaceChange
    }

    func start() throws {
        try PrivateSimulatorFrameworks.load()
        guard let device = SimulatorDeviceLookup.find(udid: deviceUDID) else {
            throw RecorderError.make(1, "Simulator \(deviceUDID) not found")
        }
        let state = device.value(forKey: "stateString") as? String ?? "unknown"
        guard state == "Booted" else {
            throw RecorderError.make(2, "Simulator \(deviceUDID) is not booted (state: \(state))")
        }
        guard
            let io = device.perform(NSSelectorFromString("io"))?.takeUnretainedValue() as? NSObject
        else {
            throw RecorderError.make(3, "Failed to get simulator IO client")
        }
        ioClient = io
        nativeRotations = Self.nativeRotations(device: device)
        try wireUpFramebuffer()
    }

    func stop() {
        unregisterCallbacks()
        descriptors.removeAll()
        integratedPanels.removeAll()
        retainedBlocks.removeAll()
        ioClient = nil
    }

    /// Foldable simulators such as iPhone Duo keep an IOSurface alive for every integrated panel,
    /// and the panel that is not in use stays black. Record all integrated panels so the video
    /// follows a fold; other simulators record their largest surface.
    func frameSnapshot() -> FrameSnapshot? {
        if integratedPanels.count >= 2 {
            let panels = integratedPanels.map {
                surfaceSnapshot(for: $0.descriptor, rotation: $0.rotation)
            }
            return panels.contains { $0 != nil } ? FrameSnapshot(panels: panels) : nil
        }
        let largest = descriptors.compactMap { surfaceSnapshot(for: $0, rotation: 0) }.max {
            $0.width * $0.height < $1.width * $1.height
        }
        return largest.map { FrameSnapshot(panels: [$0]) }
    }

    private func surfaceSnapshot(for descriptor: NSObject, rotation: Int) -> SurfaceSnapshot? {
        guard
            let surfaceObject = descriptor.perform(NSSelectorFromString("framebufferSurface"))?
                .takeUnretainedValue()
        else {
            return nil
        }
        let surface = unsafeBitCast(surfaceObject, to: IOSurface.self)
        let width = IOSurfaceGetWidth(surface)
        let height = IOSurfaceGetHeight(surface)
        guard width > 0, height > 0 else {
            return nil
        }
        return SurfaceSnapshot(
            surface: surface,
            width: width,
            height: height,
            seed: IOSurfaceGetSeed(surface),
            rotation: rotation
        )
    }

    func rewireFramebuffer() throws {
        try wireUpFramebuffer()
    }

    private func wireUpFramebuffer() throws {
        guard let io = ioClient else {
            throw RecorderError.make(3, "No simulator IO client")
        }
        io.perform(NSSelectorFromString("updateIOPorts"))
        let nextDescriptors = try findFramebufferDescriptors(io: io)
        unregisterCallbacks()
        descriptors = nextDescriptors
        integratedPanels = Self.integratedPanels(in: nextDescriptors).map { panel in
            // A panel mounted at 270 degrees, such as the iPhone Duo inner panel, turns 90
            // degrees clockwise to be upright.
            let nativeRotation = nativeRotations[panel.screenID] ?? 0
            return (panel.descriptor, (360 - nativeRotation) % 360)
        }
        retainedBlocks.removeAll()
        do {
            for descriptor in descriptors {
                try registerCallbacks(descriptor: descriptor)
            }
        } catch {
            unregisterCallbacks()
            descriptors.removeAll()
            integratedPanels.removeAll()
            retainedBlocks.removeAll()
            throw error
        }
    }

    private func findFramebufferDescriptors(io: NSObject) throws -> [NSObject] {
        guard let ports = io.value(forKey: "deviceIOPorts") as? [NSObject] else {
            throw RecorderError.make(4, "Failed to read simulator IO ports")
        }
        let portIdentifierSelector = NSSelectorFromString("portIdentifier")
        let descriptorSelector = NSSelectorFromString("descriptor")
        let surfaceSelector = NSSelectorFromString("framebufferSurface")

        var candidates: [NSObject] = []
        for port in ports {
            guard port.responds(to: portIdentifierSelector),
                let portIdentifier = port.perform(portIdentifierSelector)?.takeUnretainedValue(),
                "\(portIdentifier)" == "com.apple.framebuffer.display",
                port.responds(to: descriptorSelector),
                let descriptor = port.perform(descriptorSelector)?.takeUnretainedValue()
                    as? NSObject,
                descriptor.responds(to: surfaceSelector)
            else {
                continue
            }
            candidates.append(descriptor)
        }
        if candidates.isEmpty {
            throw RecorderError.make(5, "No framebuffer display descriptor found")
        }
        return candidates
    }

    /// Xcode releases without the screen properties API report no integrated panels, which keeps
    /// them on the largest-surface path.
    private static func integratedPanels(
        in descriptors: [NSObject]
    ) -> [(screenID: UInt32, descriptor: NSObject)] {
        typealias Panel = (screenID: UInt32, descriptor: NSObject)
        let panels = descriptors.compactMap { descriptor -> Panel? in
            let selector = NSSelectorFromString("screenProperties")
            guard descriptor.responds(to: selector),
                let properties = descriptor.perform(selector)?.takeUnretainedValue()
            else {
                return nil
            }
            let object: AnyObject = properties
            guard object.recordSimScreenType?() == integratedScreenType,
                let screenID = object.recordSimScreenID?()
            else {
                return nil
            }
            return (screenID, descriptor)
        }
        return panels.sorted { $0.screenID < $1.screenID }
    }

    /// The device profile that serve-sim also reads. A missing profile means no rotation.
    private static func nativeRotations(device: NSObject) -> [UInt32: Int] {
        let typeSelector = NSSelectorFromString("deviceType")
        let capabilitiesSelector = NSSelectorFromString("capabilities")
        guard device.responds(to: typeSelector),
            let type = device.perform(typeSelector)?.takeUnretainedValue() as? NSObject,
            type.responds(to: capabilitiesSelector),
            let profile = type.perform(capabilitiesSelector)?.takeUnretainedValue()
                as? [String: Any],
            let capabilities = profile["capabilities"] as? [String: Any],
            let displays = capabilities["displays"] as? [[String: Any]]
        else {
            return [:]
        }
        var rotations: [UInt32: Int] = [:]
        for display in displays {
            guard display["displayType"] as? String == "integrated",
                let id = display["screenID"] as? NSNumber,
                let screenID = UInt32(exactly: id.int64Value),
                let rotation = display["nativeRotation"] as? NSNumber,
                [0, 90, 180, 270].contains(rotation.intValue)
            else {
                continue
            }
            rotations[screenID] = rotation.intValue
        }
        return rotations
    }

    private static let integratedScreenType: UInt64 = 0

    private func registerCallbacks(descriptor: NSObject) throws {
        let selector = NSSelectorFromString(
            "registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:"
        )
        guard descriptor.responds(to: selector) else {
            throw RecorderError.make(6, "Framebuffer descriptor does not support screen callbacks")
        }
        guard let msgSendPointer = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "objc_msgSend")
        else {
            throw RecorderError.make(7, "objc_msgSend not found")
        }
        typealias MsgSend =
            @convention(c) (
                AnyObject, Selector, AnyObject, AnyObject, AnyObject, AnyObject, AnyObject
            ) -> Void
        let msgSend = unsafeBitCast(msgSendPointer, to: MsgSend.self)

        let uuid = NSUUID()
        callbackUUIDs[ObjectIdentifier(descriptor)] = uuid

        let frameCallback: @convention(block) () -> Void = { [weak self] in
            self?.onFrame()
        }
        let surfacesCallback: @convention(block) (AnyObject?, AnyObject?) -> Void = {
            [weak self] _, _ in
            self?.onSurfaceChange()
        }
        let propertiesCallback: @convention(block) () -> Void = {}
        retainedBlocks.append(frameCallback as AnyObject)
        retainedBlocks.append(surfacesCallback as AnyObject)
        retainedBlocks.append(propertiesCallback as AnyObject)

        msgSend(
            descriptor,
            selector,
            uuid,
            callbackQueue as AnyObject,
            frameCallback as AnyObject,
            surfacesCallback as AnyObject,
            propertiesCallback as AnyObject
        )
    }

    private func unregisterCallbacks() {
        let selector = NSSelectorFromString("unregisterScreenCallbacksWithUUID:")
        for descriptor in descriptors {
            if let uuid = callbackUUIDs[ObjectIdentifier(descriptor)],
                descriptor.responds(to: selector)
            {
                descriptor.perform(selector, with: uuid)
            }
        }
        callbackUUIDs.removeAll()
    }
}

/// Getters from the CoreSimDeviceIO SimScreenProperties protocol. Optional dispatch keeps Xcode
/// releases that lack them working.
@objc private protocol SimScreenPropertiesAccess {
    @objc(screenID) func recordSimScreenID() -> UInt32
    @objc(screenType) func recordSimScreenType() -> UInt64
}
