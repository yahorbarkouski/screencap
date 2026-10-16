import Foundation
import Testing

@testable import ScreencapCore

@Suite struct SecretScrubberTests {
  @Test(arguments: [
    "Your new key: sk-or-v1-" + String(repeating: "0a1b2c3d", count: 8),
    "export OPENAI_API_KEY=sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8tUv",
    "aws_access_key_id = AKIAIOSFODNN7EXAMPLE",
    "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "token ghp_" + String(repeating: "aB3dE", count: 7),
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "Recovery key 0123abcd-4567ef01-89abcdef-01234567-89abcdef-0123abcd-4567ef01-89abcdef",
    "R2 secret 4f6e8a0b2c4d6e8f0a1b3c5d7e9f1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e1f2a",
    "Card 4111 1111 1111 1111 exp 12/29",
    "IBAN DE89 3704 0044 0532 0130 00",
    "Pay to GB82WEST12345698765432 today",
  ])
  func masksSecrets(_ text: String) {
    let (scrubbed, found) = SecretScrubber.scrub(text)
    #expect(found)
    #expect(scrubbed.contains(SecretScrubber.mask))
  }

  @Test(arguments: [
    "Fix the join threshold in UnderstandingEngine.swift and rerun the tests",
    "commit 1074e60cdfa66d75516f2cf32a5c7e94e4a0b1c2 Backup takes Amazon S3",
    "Sources/ScreencapCore/Understanding/UnderstandingEngine",
    "MyVeryLongCamelCaseFunctionNameWithNumbers123 returns kSecAttrAccessibleAfterFirstUnlock",
    "Call me at +1 415 555 0134 on 2026-10-15 at 21:27",
    "Order 1234 5678 9012 3456 shipped",
    "https://github.com/yahorbarkouski/screencap/pull/12",
  ])
  func leavesOrdinaryTextAlone(_ text: String) {
    let (scrubbed, found) = SecretScrubber.scrub(text)
    #expect(!found)
    #expect(scrubbed == text)
  }

  @Test func titlesAndPathsAreScrubbedWhenCaptured() {
    let context = ForegroundContext(
      appName: "Terminal", windowTitle: "zsh — export OPENROUTER_API_KEY=sk-or-v1-" + String(repeating: "9f8e7d6c", count: 8),
      urlHost: "example.com", urlPath: "/reset/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")
    #expect(context.scrubbed.windowTitle == "zsh — export OPENROUTER_API_KEY=\(SecretScrubber.mask)")
    #expect(context.scrubbed.urlPath == "/reset/\(SecretScrubber.mask)")
  }

  @Test func storedTextIsScrubbedAndTheFrameIsKeptFromModels() async throws {
    let h = try Harness(textOnly: false)
    try FileManager.default.createDirectory(at: h.location.url("Frames"), withIntermediateDirectories: true)
    try Data([0]).write(to: h.location.url("Frames/key.heic"))
    let capture = try h.add("Dia", at: 1000, ocr: .pending, frame: "Frames/key.heic")
    let line = OCRLine(text: "sk-or-v1-" + String(repeating: "0a1b2c3d", count: 8), x: 0, y: 0, width: 1, height: 0.1)
    try h.database.saveOCR(captureID: capture.id, lines: [line], milliseconds: 1)
    #expect(try h.database.ocrLines(captureID: capture.id).map(\.text) == [SecretScrubber.mask])
    #expect(try await h.engine.modelImage(capture) == nil)
  }

  @Test func secretsStoredByOlderBuildsAreMaskedOnce() throws {
    let h = try Harness()
    let key = "sk-or-v1-" + String(repeating: "0a1b2c3d", count: 8)
    let capture = try h.add("Terminal", at: 1000, ocr: .pending)
    try h.database.writer.write { db in
      try db.execute(
        sql: "INSERT OR REPLACE INTO captureText (captureID, lines, ocrMS) VALUES (?, ?, 1)",
        arguments: [capture.id, #"[{"text":"key \#(key)","x":0,"y":0,"width":1,"height":0.1}]"#])
      try db.execute(sql: "UPDATE capture SET windowTitle = ? WHERE id = ?", arguments: ["export KEY=\(key)", capture.id])
    }
    #expect(try h.database.scrubStoredSecrets() == 2)
    #expect(try h.database.ocrLines(captureID: capture.id).map(\.text) == ["key \(SecretScrubber.mask)"])
    #expect(try h.database.capture(id: capture.id)?.context.windowTitle == "export KEY=\(SecretScrubber.mask)")
    #expect(try h.database.scrubStoredSecrets() == 0)
  }
}
