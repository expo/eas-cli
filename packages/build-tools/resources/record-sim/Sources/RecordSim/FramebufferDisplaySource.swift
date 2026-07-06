import Foundation
import IOSurface
import ObjectiveC

final class FramebufferDisplaySource {
    struct SurfaceSnapshot {
        let surface: IOSurface
        let width: Int
        let height: Int
        let seed: UInt32
    }

    private let deviceUDID: String
    private let callbackQueue: DispatchQueue
    private let onFrame: () -> Void
    private let onSurfaceChange: () -> Void
    private var descriptors: [NSObject] = []
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
        try wireUpFramebuffer()
    }

    func stop() {
        unregisterCallbacks()
        descriptors.removeAll()
        retainedBlocks.removeAll()
        ioClient = nil
    }

    func surfaceSnapshot() -> SurfaceSnapshot? {
        let surfaceSelector = NSSelectorFromString("framebufferSurface")
        var bestSnapshot: SurfaceSnapshot?
        var bestArea = 0
        for descriptor in descriptors {
            guard let surfaceObject = descriptor.perform(surfaceSelector)?.takeUnretainedValue()
            else {
                continue
            }
            let surface = unsafeBitCast(surfaceObject, to: IOSurface.self)
            let width = IOSurfaceGetWidth(surface)
            let height = IOSurfaceGetHeight(surface)
            let area = width * height
            if area > bestArea {
                bestSnapshot = SurfaceSnapshot(
                    surface: surface,
                    width: width,
                    height: height,
                    seed: IOSurfaceGetSeed(surface)
                )
                bestArea = area
            }
        }
        return bestSnapshot
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
        retainedBlocks.removeAll()
        do {
            for descriptor in descriptors {
                try registerCallbacks(descriptor: descriptor)
            }
        } catch {
            unregisterCallbacks()
            descriptors.removeAll()
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
