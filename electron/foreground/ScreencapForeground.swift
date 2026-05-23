import AppKit
import CoreGraphics
import Foundation

struct ForegroundOutput: Codable {
	let appName: String
	let bundleId: String
	let pid: Int32
	let windowTitle: String
	let x: Int
	let y: Int
	let width: Int
	let height: Int
}

func writeJson<T: Encodable>(_ value: T) {
	do {
		let data = try JSONEncoder().encode(value)
		FileHandle.standardOutput.write(data)
		FileHandle.standardOutput.write(Data([0x0A]))
	} catch {
		FileHandle.standardOutput.write(Data("null\n".utf8))
		exit(2)
	}
}

func writeNull() {
	FileHandle.standardOutput.write(Data("null\n".utf8))
}

func stringValue(_ value: Any?) -> String {
	value as? String ?? ""
}

func doubleValue(_ value: Any?) -> Double? {
	if let number = value as? NSNumber {
		return number.doubleValue
	}

	return value as? Double
}

func intValue(_ value: Any?) -> Int? {
	if let number = value as? NSNumber {
		return number.intValue
	}

	return value as? Int
}

guard let app = NSWorkspace.shared.frontmostApplication else {
	writeNull()
	exit(0)
}

let pid = app.processIdentifier
let appName = app.localizedName ?? ""
let bundleId = app.bundleIdentifier ?? ""
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let windowInfo = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []

var windowTitle = ""
var x = 0
var y = 0
var width = 0
var height = 0

for window in windowInfo {
	guard intValue(window[kCGWindowOwnerPID as String]) == Int(pid) else {
		continue
	}

	if let layer = intValue(window[kCGWindowLayer as String]), layer > 0 {
		continue
	}

	if let alpha = doubleValue(window[kCGWindowAlpha as String]), alpha < 0.1 {
		continue
	}

	guard
		let bounds = window[kCGWindowBounds as String] as? [String: Any],
		let candidateWidth = doubleValue(bounds["Width"]),
		let candidateHeight = doubleValue(bounds["Height"]),
		candidateWidth >= 10,
		candidateHeight >= 10
	else {
		continue
	}

	windowTitle = stringValue(window[kCGWindowName as String])
	x = Int((doubleValue(bounds["X"]) ?? 0).rounded())
	y = Int((doubleValue(bounds["Y"]) ?? 0).rounded())
	width = Int(candidateWidth.rounded())
	height = Int(candidateHeight.rounded())
	break
}

writeJson(
	ForegroundOutput(
		appName: appName,
		bundleId: bundleId,
		pid: pid,
		windowTitle: windowTitle,
		x: x,
		y: y,
		width: width,
		height: height
	)
)
