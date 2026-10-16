// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Screencap",
  platforms: [.macOS("26.0")],
  products: [
    .executable(name: "Screencap", targets: ["Screencap"]),
    .executable(name: "screencap-ocr", targets: ["ScreencapOCR"]),
  ],
  dependencies: [
    .package(url: "https://github.com/groue/GRDB.swift.git", exact: "7.10.0"),
    .package(url: "https://github.com/sparkle-project/Sparkle.git", exact: "2.10.0"),
  ],
  targets: [
    .target(
      name: "ScreencapCore",
      dependencies: [.product(name: "GRDB", package: "GRDB.swift")]
    ),
    .executableTarget(
      name: "Screencap",
      dependencies: ["ScreencapCore", .product(name: "Sparkle", package: "Sparkle")],
      // Inside the app bundle, Sparkle.framework sits in Contents/Frameworks.
      linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]
    ),
    .executableTarget(name: "ScreencapOCR"),
    .testTarget(
      name: "ScreencapCoreTests",
      dependencies: ["ScreencapCore"]
    ),
  ]
)
