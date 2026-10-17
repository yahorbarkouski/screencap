import CryptoKit
import Foundation

/// A piece of a question's state: text, or a JPEG screenshot.
public enum StatePart: Sendable, Hashable {
  case text(String)
  case image(Data)
}

public struct ChoiceOption: Sendable, Hashable {
  public let key: String
  public let criterion: String

  public init(key: String, criterion: String) {
    self.key = key
    self.criterion = criterion
  }
}

public enum DecisionQuestion: Sendable, Hashable {
  /// Yes/no; the answer is the probability of yes.
  case noul(String)
  /// One of the options, in the order given.
  case choice(String, [ChoiceOption])
}

public enum DecisionAnswer: Sendable, Hashable {
  case noul(Double)
  case choice(String, [String: Double])

  public var yesProbability: Double? {
    if case .noul(let p) = self { return p }
    return nil
  }

  public var choice: (key: String, probability: Double)? {
    if case .choice(let key, let probabilities) = self { return (key, probabilities[key] ?? 0) }
    return nil
  }
}

public struct ModelUsage: Sendable, Hashable {
  public var model: String
  public var inputTokens: Int
  public var costUSD: Double
  public var latencyMS: Int
}

public struct DecisionResult: Sendable {
  public var answers: [String: DecisionAnswer]
  public var usage: ModelUsage
}

public struct TextResult: Sendable {
  public var values: [String: String]
  public var usage: ModelUsage
}

/// A model that answers fixed-choice questions with a probability per answer.
public protocol DecisionModel: Sendable {
  func decide(state: [StatePart], questions: [(key: String, question: DecisionQuestion)]) async throws -> DecisionResult
}

/// A small generative model that returns a JSON object with the given string keys.
public protocol TextModel: Sendable {
  func json(content: [StatePart], keys: [String], purpose: String) async throws -> TextResult
}

public enum ModelError: Error, CustomStringConvertible {
  case missingKey
  case http(Int, String)
  case malformed(String)

  /// What went wrong in a few words, with no part of the request in it: the HTTP status and the message
  /// OpenRouter gave, or the kind of answer that could not be read.
  public var summary: String {
    switch self {
    case .missingKey: return "no OpenRouter key"
    case .http(let status, let body):
      let message = (try? JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any])
        .flatMap { $0["error"] as? [String: Any] }.flatMap { $0["message"] as? String }
      return message.map { "HTTP \(status): \($0)" } ?? "HTTP \(status)"
    case .malformed: return "an answer the app could not read"
    }
  }

  public var description: String {
    switch self {
    case .missingKey: "no OpenRouter key"
    case .http(let status, let body): "HTTP \(status): \(body)"
    case .malformed(let what): "malformed response: \(what)"
    }
  }
}

/// OpenRouter's endpoints: `/api/alpha/decisions` for decision models and chat completions with a strict JSON schema
/// for the text model.
public struct OpenRouter: Sendable {
  /// The decision models, asked in this order: each has the same contract, and the next is asked only when one
  /// fails. Every request asks for zero data retention, so a model with no such endpoint fails and is passed over.
  /// On 17 October 2026 Perplexity withdrew v1 and v1.1 the day after v1.2 arrived, and nothing was sorted for
  /// three hours; that day Luna's decision model had no zero-retention endpoint, so it answers only once it has one.
  public static let deciders = [
    "perplexity/pplx-decider-v1.2", "perplexity/pplx-decider-flash-v1.2", "openai/gpt-6-luna-decisions",
  ]
  public static let decider = deciders[0]
  public static let writer = "openai/gpt-6-luna"

  let key: @Sendable () -> String?
  let session: URLSession
  let cache: ResponseCache?

  public init(key: @escaping @Sendable () -> String?, cache: ResponseCache? = nil) {
    self.key = key
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 120
    configuration.httpMaximumConnectionsPerHost = 16
    session = URLSession(configuration: configuration)
    self.cache = cache
  }

  /// The key from the Keychain, or `OPENROUTER_API_KEY` for command-line runs.
  /// `OPENROUTER_API_KEY` from the environment (command-line runs), else the key saved in Settings. The environment
  /// comes first so an unsigned development build never asks the Keychain for the signed app's item.
  public static func storedKey() -> String? {
    ProcessInfo.processInfo.environment["OPENROUTER_API_KEY"] ?? Keychain.readString(.openRouterKey)
  }

  /// Routes only to endpoints that keep no prompts (OpenRouter's Zero Data Retention list) and never train on them;
  /// a request with no such endpoint fails instead of falling back to one that retains.
  static let privateRouting = JSONValue.object([("zdr", .bool(true)), ("data_collection", .string("deny"))])

  func post(_ path: String, body: JSONValue) async throws -> (json: [String: Any], latencyMS: Int) {
    let data = body.data
    if let cached = cache?.read(data), let json = try? JSONSerialization.jsonObject(with: cached) as? [String: Any] {
      return (json, 0)
    }
    guard let key = key(), !key.isEmpty else { throw ModelError.missingKey }
    var request = URLRequest(url: URL(string: "https://openrouter.ai\(path)")!)
    request.httpMethod = "POST"
    request.httpBody = data
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
    request.setValue("Screencap/0.1", forHTTPHeaderField: "User-Agent")
    let started = DispatchTime.now().uptimeNanoseconds
    let (responseData, response) = try await sendWithTransportRetry(request)
    let latency = Int((DispatchTime.now().uptimeNanoseconds - started) / 1_000_000)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else {
      throw ModelError.http(status, String(decoding: responseData.prefix(400), as: UTF8.self))
    }
    guard let json = try JSONSerialization.jsonObject(with: responseData) as? [String: Any] else {
      throw ModelError.malformed("not an object")
    }
    cache?.write(data, responseData)
    return (json, latency)
  }

  /// Transport retry for provider outages only (a dropped connection, a timeout, HTTP 429/502/503/504), twice with
  /// backoff. This is infrastructure: it never retries an answer the model gave.
  func sendWithTransportRetry(_ request: URLRequest) async throws -> (Data, URLResponse) {
    let transient: Set<URLError.Code> = [.networkConnectionLost, .timedOut, .cannotConnectToHost, .notConnectedToInternet, .dnsLookupFailed]
    var attempt = 0
    while true {
      do {
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if [429, 502, 503, 504].contains(status), attempt < 2 {
          attempt += 1
          try await Task.sleep(for: .seconds(Double(attempt * attempt) * 2))
          continue
        }
        return (data, response)
      } catch let error as URLError where transient.contains(error.code) && attempt < 2 {
        attempt += 1
        try await Task.sleep(for: .seconds(Double(attempt * attempt) * 2))
      }
    }
  }

  static func stateJSON(_ parts: [StatePart]) -> [JSONValue] {
    parts.map { part in
      switch part {
      case .text(let text): .string(text)
      case .image(let jpeg):
        .object([
          ("type", .string("image_url")),
          ("image_url", .object([("url", .string("data:image/jpeg;base64," + jpeg.base64EncodedString()))])),
        ])
      }
    }
  }

  static func usage(_ json: [String: Any], model: String, latency: Int) -> ModelUsage {
    let usage = json["usage"] as? [String: Any] ?? [:]
    let tokens = (usage["input_tokens"] as? Int) ?? (usage["prompt_tokens"] as? Int) ?? 0
    let cost = (usage["cost"] as? Double) ?? (usage["cost"] as? NSNumber)?.doubleValue ?? 0
    return ModelUsage(model: model, inputTokens: tokens, costUSD: cost, latencyMS: latency)
  }
}

public struct OpenRouterDecider: DecisionModel {
  let client: OpenRouter
  let models: [String]

  public init(client: OpenRouter, models: [String] = OpenRouter.deciders) {
    self.client = client
    self.models = models
  }

  public func decide(state: [StatePart], questions: [(key: String, question: DecisionQuestion)]) async throws
    -> DecisionResult
  {
    try await Self.firstAnswer(from: models) { model in try await decide(state: state, questions: questions, model: model) }
  }

  /// The answer of the first model that gives one. When none does, the first model's error is thrown, since the
  /// models after it are there only to stand in for it.
  static func firstAnswer<Answer>(from models: [String], _ ask: (String) async throws -> Answer) async throws -> Answer {
    var first: Error?
    for model in models {
      try Task.checkCancellation()
      do { return try await ask(model) } catch { first = first ?? error }
    }
    throw first ?? ModelError.malformed("no decision model to ask")
  }

  private func decide(state: [StatePart], questions: [(key: String, question: DecisionQuestion)], model: String)
    async throws -> DecisionResult
  {
    let questionJSON: [(String, JSONValue)] = questions.map { key, question in
      switch question {
      case .noul(let instructions):
        (key, .object([("type", .string("noul")), ("instructions", .string(instructions))]))
      case .choice(let instructions, let options):
        (
          key,
          .object([
            ("type", .string("choice")), ("instructions", .string(instructions)),
            ("criteria", .object(options.map { ($0.key, .string($0.criterion)) })),
          ])
        )
      }
    }
    let body = JSONValue.object([
      ("model", .string(model)), ("state", .array(OpenRouter.stateJSON(state))), ("questions", .object(questionJSON)),
      ("provider", OpenRouter.privateRouting),
    ])
    let (json, latency) = try await client.post("/api/alpha/decisions", body: body)
    guard let answers = json["answers"] as? [String: Any] else { throw ModelError.malformed("no answers") }
    var parsed: [String: DecisionAnswer] = [:]
    for (key, _) in questions {
      guard let answer = answers[key] as? [String: Any] else { throw ModelError.malformed("no answer for \(key)") }
      if let p = (answer["noul"] as? NSNumber)?.doubleValue {
        parsed[key] = .noul(p)
      } else if let choice = answer["choice"] as? String {
        let probabilities = (answer["probabilities"] as? [String: Any] ?? [:]).compactMapValues { ($0 as? NSNumber)?.doubleValue }
        parsed[key] = .choice(choice, probabilities)
      } else {
        throw ModelError.malformed("answer \(key)")
      }
    }
    return DecisionResult(answers: parsed, usage: OpenRouter.usage(json, model: model, latency: latency))
  }
}

public struct OpenRouterWriter: TextModel {
  let client: OpenRouter
  let model: String

  public init(client: OpenRouter, model: String = OpenRouter.writer) {
    self.client = client
    self.model = model
  }

  public func json(content: [StatePart], keys: [String], purpose: String) async throws -> TextResult {
    let messageContent: JSONValue
    if content.count == 1, case .text(let text) = content[0] {
      messageContent = .string(text)
    } else {
      messageContent = .array(
        content.map { part in
          switch part {
          case .text(let text): .object([("type", .string("text")), ("text", .string(text))])
          case .image(let jpeg):
            .object([
              ("type", .string("image_url")),
              ("image_url", .object([("url", .string("data:image/jpeg;base64," + jpeg.base64EncodedString()))])),
            ])
          }
        })
    }
    let schema = JSONValue.object([
      ("type", .string("object")),
      ("properties", .object(keys.map { ($0, .object([("type", .string("string"))])) })),
      ("required", .array(keys.map { .string($0) })),
      ("additionalProperties", .bool(false)),
    ])
    let body = JSONValue.object([
      ("model", .string(model)),
      ("messages", .array([.object([("role", .string("user")), ("content", messageContent)])])),
      (
        "response_format",
        .object([
          ("type", .string("json_schema")),
          ("json_schema", .object([("name", .string(purpose.replacingOccurrences(of: "-", with: "_"))), ("strict", .bool(true)), ("schema", schema)])),
        ])
      ),
      ("reasoning", .object([("effort", .string("low"))])),
      ("max_tokens", .number(4000)),
      ("provider", OpenRouter.privateRouting),
    ])
    let (json, latency) = try await client.post("/api/v1/chat/completions", body: body)
    guard let choices = json["choices"] as? [[String: Any]], let message = choices.first?["message"] as? [String: Any],
      let text = message["content"] as? String, let start = text.firstIndex(of: "{"), let end = text.lastIndex(of: "}"),
      let object = try JSONSerialization.jsonObject(with: Data(text[start...end].utf8)) as? [String: Any]
    else { throw ModelError.malformed("no JSON content") }
    var values: [String: String] = [:]
    for key in keys {
      guard let value = object[key] as? String else { throw ModelError.malformed("missing \(key)") }
      values[key] = value
    }
    return TextResult(values: values, usage: OpenRouter.usage(json, model: model, latency: latency))
  }
}

/// Responses stored by the exact request body. Only replays use it, so reruns cost nothing.
public struct ResponseCache: Sendable {
  let directory: URL

  public init(directory: URL) {
    self.directory = directory
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  func path(_ request: Data) -> URL {
    let digest = SHA256.hash(data: request).map { String(format: "%02x", $0) }.joined()
    return directory.appendingPathComponent(String(digest.prefix(2))).appendingPathComponent("\(digest).json")
  }

  func read(_ request: Data) -> Data? { try? Data(contentsOf: path(request)) }

  func write(_ request: Data, _ response: Data) {
    let url = path(request)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? response.write(to: url, options: .atomic)
  }
}
