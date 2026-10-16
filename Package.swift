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
    .package(url: "https://github.com/groue/GRDB.swift.git", exact: "7.10.0")
  ],
  targets: [
    .target(
      name: "ScreencapCore",
      dependencies: [.product(name: "GRDB", package: "GRDB.swift")]
    ),
    .executableTarget(
      name: "Screencap",
      dependencies: ["ScreencapCore"]
    ),
    .executableTarget(name: "ScreencapOCR"),
    .testTarget(
      name: "ScreencapCoreTests",
      dependencies: ["ScreencapCore"]
    ),
  ]
)
