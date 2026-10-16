import CryptoKit
import Foundation

/// AWS Signature Version 4 for S3-compatible stores (R2 uses region `auto`). About a page of code instead of the AWS
/// SDK's dozens of modules for four requests.
public struct SigV4: Sendable {
  public let accessKeyID: String
  public let secretAccessKey: String
  public let region: String
  public let service = "s3"

  public init(accessKeyID: String, secretAccessKey: String, region: String) {
    self.accessKeyID = accessKeyID
    self.secretAccessKey = secretAccessKey
    self.region = region
  }

  /// Adds `x-amz-date`, `x-amz-content-sha256` and `Authorization` to a request whose URL, method and other headers
  /// are final.
  public func sign(_ request: inout URLRequest, payload: Data, date: Date = Date()) {
    let amzDate = Self.timestamp(date)
    let day = String(amzDate.prefix(8))
    let payloadHash = Self.hex(SHA256.hash(data: payload))
    request.setValue(amzDate, forHTTPHeaderField: "x-amz-date")
    request.setValue(payloadHash, forHTTPHeaderField: "x-amz-content-sha256")
    let url = request.url!
    var headers: [(String, String)] = [("host", Self.hostHeader(url))]
    for (name, value) in request.allHTTPHeaderFields ?? [:] where name.lowercased() != "host" && name.lowercased() != "authorization" {
      headers.append((name.lowercased(), value.trimmingCharacters(in: .whitespaces)))
    }
    headers.sort { $0.0 < $1.0 }
    let signedHeaders = headers.map(\.0).joined(separator: ";")
    let canonical = [
      request.httpMethod ?? "GET",
      Self.canonicalPath(url),
      Self.canonicalQuery(url),
      headers.map { "\($0.0):\($0.1)\n" }.joined(),
      signedHeaders,
      payloadHash,
    ].joined(separator: "\n")
    let scope = "\(day)/\(region)/\(service)/aws4_request"
    let stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, Self.hex(SHA256.hash(data: Data(canonical.utf8)))].joined(separator: "\n")
    var key = SymmetricKey(data: Data("AWS4\(secretAccessKey)".utf8))
    for part in [day, region, service, "aws4_request"] {
      key = SymmetricKey(data: Data(HMAC<SHA256>.authenticationCode(for: Data(part.utf8), using: key)))
    }
    let signature = Self.hex(HMAC<SHA256>.authenticationCode(for: Data(stringToSign.utf8), using: key))
    request.setValue(
      "AWS4-HMAC-SHA256 Credential=\(accessKeyID)/\(scope), SignedHeaders=\(signedHeaders), Signature=\(signature)",
      forHTTPHeaderField: "Authorization")
  }

  static func timestamp(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
    return formatter.string(from: date)
  }

  static func hostHeader(_ url: URL) -> String {
    let host = url.host() ?? ""
    if let port = url.port, !((url.scheme == "https" && port == 443) || (url.scheme == "http" && port == 80)) {
      return "\(host):\(port)"
    }
    return host
  }

  /// RFC 3986 encoding of each path segment; S3 does not normalize the path.
  static func canonicalPath(_ url: URL) -> String {
    let path = url.path(percentEncoded: false)
    guard !path.isEmpty else { return "/" }
    return path.split(separator: "/", omittingEmptySubsequences: false).map { encode(String($0)) }.joined(separator: "/")
  }

  static func canonicalQuery(_ url: URL) -> String {
    guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return "" }
    return items.map { (encode($0.name), encode($0.value ?? "")) }.sorted { $0 < $1 }.map { "\($0.0)=\($0.1)" }
      .joined(separator: "&")
  }

  static let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

  static func encode(_ text: String) -> String {
    text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? text
  }

  static func hex<D: Sequence>(_ digest: D) -> String where D.Element == UInt8 {
    digest.map { String(format: "%02x", $0) }.joined()
  }
}

public enum S3Error: Error, CustomStringConvertible {
  case http(Int, String)
  case notFound(String)

  public var description: String {
    switch self {
    case .http(let status, let body): "S3 HTTP \(status): \(body)"
    case .notFound(let key): "not found: \(key)"
    }
  }
}

/// The four requests the backup needs, path-style (`<endpoint>/<bucket>/<key>`).
public struct S3Client: Sendable {
  let endpoint: URL
  let bucket: String
  let signer: SigV4

  /// One session for every client: a session lives until it is invalidated, and the app builds a client per backup run.
  static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.waitsForConnectivity = true
    configuration.allowsConstrainedNetworkAccess = false
    configuration.networkServiceType = .background
    configuration.timeoutIntervalForRequest = 120
    configuration.timeoutIntervalForResource = 600
    return URLSession(configuration: configuration)
  }()

  public init(endpoint: URL, bucket: String, signer: SigV4) {
    self.endpoint = endpoint
    self.bucket = bucket
    self.signer = signer
  }

  public init?(settings: BackupSettings, secret: String?) {
    guard settings.isConfigured, let secret, let url = settings.endpointURL else { return nil }
    self.init(
      endpoint: url, bucket: settings.bucket, signer: SigV4(accessKeyID: settings.accessKeyID, secretAccessKey: secret, region: settings.signingRegion))
  }

  func url(_ key: String, query: [URLQueryItem] = []) -> URL {
    var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!
    let encodedKey = key.split(separator: "/", omittingEmptySubsequences: false).map { SigV4.encode(String($0)) }.joined(separator: "/")
    components.percentEncodedPath = "/\(SigV4.encode(bucket))" + (key.isEmpty ? "" : "/\(encodedKey)")
    if !query.isEmpty { components.queryItems = query }
    return components.url!
  }

  func send(_ method: String, _ url: URL, body: Data = Data()) async throws -> Data {
    var request = URLRequest(url: url)
    request.httpMethod = method
    if !body.isEmpty || method == "PUT" { request.httpBody = body }
    signer.sign(&request, payload: body)
    let (data, response) = try await Self.session.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status == 404 { throw S3Error.notFound(url.path) }
    guard (200..<300).contains(status) else { throw S3Error.http(status, String(decoding: data.prefix(300), as: UTF8.self)) }
    return data
  }

  public func put(_ key: String, _ data: Data) async throws { _ = try await send("PUT", url(key), body: data) }
  public func get(_ key: String) async throws -> Data { try await send("GET", url(key)) }

  public func delete(_ key: String) async throws {
    do { _ = try await send("DELETE", url(key)) } catch S3Error.notFound { return }
  }

  /// Every key under a prefix (ListObjectsV2, following continuation tokens).
  public func list(prefix: String) async throws -> [String] {
    var keys: [String] = []
    var token: String?
    repeat {
      var query = [URLQueryItem(name: "list-type", value: "2"), URLQueryItem(name: "prefix", value: prefix)]
      if let token { query.append(URLQueryItem(name: "continuation-token", value: token)) }
      let data = try await send("GET", url("", query: query))
      let parser = ListParser()
      let xml = XMLParser(data: data)
      xml.delegate = parser
      xml.parse()
      keys += parser.keys
      token = parser.isTruncated ? parser.nextToken : nil
    } while token != nil
    return keys
  }

  public func contains(prefix: String) async throws -> Bool {
    let query = [URLQueryItem(name: "list-type", value: "2"), URLQueryItem(name: "max-keys", value: "1"), URLQueryItem(name: "prefix", value: prefix)]
    let parser = ListParser()
    let xml = XMLParser(data: try await send("GET", url("", query: query)))
    xml.delegate = parser
    xml.parse()
    return !parser.keys.isEmpty
  }
}

final class ListParser: NSObject, XMLParserDelegate {
  var keys: [String] = []
  var isTruncated = false
  var nextToken: String?
  private var text = ""

  func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
    text = ""
  }

  func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }

  func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
    switch name {
    case "Key": keys.append(text)
    case "IsTruncated": isTruncated = text == "true"
    case "NextContinuationToken": nextToken = text
    default: break
    }
  }
}
