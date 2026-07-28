// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "record-sim",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(name: "RecordSim", targets: ["RecordSim"]),
        .executable(name: "record-sim", targets: ["record-sim"]),
    ],
    targets: [
        .target(
            name: "RecordSim",
            linkerSettings: [
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("IOSurface"),
                .linkedFramework("UniformTypeIdentifiers"),
            ]
        ),
        .executableTarget(name: "record-sim", dependencies: ["RecordSim"]),
    ]
)
