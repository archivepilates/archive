// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ArchiveMacUnlock",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "archive-mac-unlock", targets: ["ArchiveMacUnlock"])],
    targets: [
        .target(name: "MacUnlockKit"),
        .executableTarget(name: "ArchiveMacUnlock", dependencies: ["MacUnlockKit"]),
        .testTarget(name: "MacUnlockKitTests", dependencies: ["MacUnlockKit"]),
    ]
)
