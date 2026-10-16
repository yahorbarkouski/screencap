import CryptoKit
import Foundation
import Testing

@testable import ScreencapCore

@Suite struct SealerTests {
  let key = BackupKey(key: SymmetricKey(size: .bits256))

  @Test func roundTrip() throws {
    let data = Data("frame bytes".utf8)
    let sealed = try Sealer.seal(data, objectKey: "f1/frames/2026/10/15/A.heic.enc", with: key)
    #expect(sealed.count == data.count + 33)
    #expect(try Sealer.open(sealed, objectKey: "f1/frames/2026/10/15/A.heic.enc", with: key) == data)
  }

  @Test func ciphertextMovedToAnotherNameIsRejected() throws {
    let sealed = try Sealer.seal(Data("frame".utf8), objectKey: "f1/frames/a.heic.enc", with: key)
    #expect(throws: (any Error).self) { try Sealer.open(sealed, objectKey: "f1/frames/b.heic.enc", with: key) }
  }

  @Test func wrongKeyIsRejected() throws {
    let sealed = try Sealer.seal(Data("frame".utf8), objectKey: "k", with: key)
    let other = BackupKey(key: SymmetricKey(size: .bits256))
    #expect(throws: SealError.self) { try Sealer.open(sealed, objectKey: "k", with: other) }
  }

  @Test func recoveryTextRoundTrips() throws {
    let restored = try #require(BackupKey(recoveryText: key.recoveryText))
    #expect(restored.id == key.id)
    #expect(key.recoveryText.split(separator: "-").count == 8)
  }
}

@Suite struct SigV4Tests {
  /// Reference signatures computed by botocore's S3SigV4Auth for the same requests.
  let signer = SigV4(accessKeyID: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", region: "auto")
  let date = ISO8601DateFormatter().date(from: "2026-10-15T12:00:35Z")!

  func authorization(_ method: String, _ url: String, body: String = "", region: String = "auto") -> String? {
    var request = URLRequest(url: URL(string: url)!)
    request.httpMethod = method
    SigV4(accessKeyID: signer.accessKeyID, secretAccessKey: signer.secretAccessKey, region: region)
      .sign(&request, payload: Data(body.utf8), date: date)
    return request.value(forHTTPHeaderField: "Authorization")
  }

  @Test func putMatchesBotocore() {
    #expect(
      authorization("PUT", "https://acct.r2.cloudflarestorage.com/screencap/f1/frames/2026/10/15/ABC.heic.enc", body: "sealed bytes")
        == "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261015/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=fc8dfe958e2aa66748c095f98241d70f534deff30dbf5a52784c083b45839ded")
  }

  @Test func listQueryMatchesBotocore() {
    #expect(
      authorization("GET", "https://acct.r2.cloudflarestorage.com/screencap?list-type=2&prefix=f1%2Frows%2F")
        == "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261015/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=08a6e6f399d294983392780cc4ad530b7e5e322640a89b96a00369589ef96825")
  }

  @Test func encodedPathAndPortMatchBotocore() {
    #expect(
      authorization("DELETE", "http://127.0.0.1:9123/bucket/f1/frames/2026/10/15/a%20b.heic.enc", region: "us-east-1")
        == "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261015/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=4635159b99326a631bcaab6340b7b1075773ed3a710f9c0234f0795fe862bd84")
  }
}

@Suite struct BackupSettingsTests {
  @Test func providersBuildTheirEndpoints() {
    var settings = BackupSettings()
    settings.region = "eu-central-1"
    #expect(settings.resolvedEndpoint == "https://s3.eu-central-1.amazonaws.com")
    #expect(settings.signingRegion == "eu-central-1")
    settings.provider = .cloudflareR2
    settings.accountID = "0123abcd"
    #expect(settings.resolvedEndpoint == "https://0123abcd.r2.cloudflarestorage.com")
    #expect(settings.signingRegion == "auto")
    settings.provider = .backblazeB2
    settings.region = "us-west-004"
    #expect(settings.resolvedEndpoint == "https://s3.us-west-004.backblazeb2.com")
  }

  @Test func anAccountCannotPointTheHostElsewhere() {
    var settings = BackupSettings()
    settings.provider = .cloudflareR2
    settings.accountID = "evil.example.com/x?"
    #expect(settings.resolvedEndpoint == "https://evilexamplecomx.r2.cloudflarestorage.com")
  }

  @Test func plainHTTPIsRefusedExceptToThisMac() {
    var settings = BackupSettings()
    settings.provider = .other
    settings.bucket = "b"
    settings.accessKeyID = "k"
    settings.endpoint = "http://s3.example.com"
    #expect(!settings.isConfigured)
    settings.endpoint = "http://localhost:9000"
    #expect(settings.isConfigured)
    settings.endpoint = "https://s3.example.com"
    #expect(settings.isConfigured)
  }

  @Test func settingsFromOlderBuildsKeepTheirProvider() throws {
    let saved = #"{"isEnabled":true,"endpoint":"https://0123abcd.r2.cloudflarestorage.com","bucket":"b","region":"auto","accessKeyID":"k"}"#
    let settings = try JSONDecoder().decode(BackupSettings.self, from: Data(saved.utf8))
    #expect(settings.provider == .cloudflareR2)
    #expect(settings.accountID == "0123abcd")
    #expect(settings.resolvedEndpoint == "https://0123abcd.r2.cloudflarestorage.com")
    let empty = try JSONDecoder().decode(BackupSettings.self, from: Data(#"{"region":"auto"}"#.utf8))
    #expect(empty.provider == .amazonS3)
    #expect(empty.region == "us-east-1")
  }
}

@Suite struct FrameFileTests {
  @Test func onlyStoreFramesAndImagesElsewhereAreUploaded() {
    #expect(BackupService.isFrameFile("Frames/2026/10/15/A.heic"))
    #expect(BackupService.isFrameFile("/Users/someone/experiments/data/img/A.jpg"))
    #expect(!BackupService.isFrameFile("/Users/someone/.ssh/id_ed25519"))
    #expect(!BackupService.isFrameFile("Frames/../../.ssh/id_ed25519"))
    #expect(!BackupService.isFrameFile("/Users/someone/Frames/../.zshrc.heic"))
  }
}
