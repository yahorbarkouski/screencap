import Darwin
import Foundation

/// Sends kept frames that still lack text to the OCR helper process and stores the result.
///
/// The helper stays up while frames keep coming: loading Vision costs about 0.11 s of CPU, a third of reading one
/// frame, and a launch per batch spent about 0.17% of a core on that alone. After `idleTimeout` without work the
/// helper's input is closed and it exits, which returns Vision's ~240 MB to the system.
public actor OCRRunner {
  struct HelperResult: Decodable {
    let id: String
    let lines: [OCRLine]?
    let ms: Int?
    let error: String?
  }

  struct HelperJob: Encodable {
    let id: String
    let path: String
  }

  let database: AppDatabase
  let location: StoreLocation
  let helperURL: URL
  let idleTimeout: Duration
  private var helper: OCRHelperProcess?
  private var idleExit: Task<Void, Never>?

  public init(database: AppDatabase, location: StoreLocation, helperURL: URL, idleTimeout: Duration = .seconds(180)) {
    self.database = database
    self.location = location
    self.helperURL = helperURL
    self.idleTimeout = idleTimeout
  }

  /// Recognizes up to `limit` pending frames. Returns the ids that now have text (or failed for good).
  @discardableResult
  public func runBatch(limit: Int = 60) async throws -> [String] {
    let pending = try database.capturesAwaitingOCR(limit: limit)
    guard !pending.isEmpty else { return [] }
    idleExit?.cancel()
    defer { scheduleIdleExit() }
    var finished: [String] = []
    for capture in pending {
      guard let path = capture.framePath else { continue }
      let job = try JSONEncoder().encode(HelperJob(id: capture.id, path: location.url(path).path))
      guard let line = try await recognize(job),
        let result = try? JSONDecoder().decode(HelperResult.self, from: line), result.id == capture.id
      else {
        // The helper exited on this frame. Mark it failed so the next helper does not stop on it again.
        try database.markOCRFailed(captureID: capture.id)
        finished.append(capture.id)
        break
      }
      if let lines = result.lines {
        try database.saveOCR(captureID: result.id, lines: lines, milliseconds: result.ms ?? 0)
      } else {
        Log.capture.error("OCR failed for \(result.id, privacy: .public): \(result.error ?? "", privacy: .public)")
        try database.markOCRFailed(captureID: result.id)
      }
      finished.append(result.id)
    }
    return finished
  }

  /// One job's result line. A helper that is no longer running (it exited while idle) is replaced once; a helper
  /// that exits after taking the job could not read this frame, and the answer is nil.
  private func recognize(_ job: Data) async throws -> Data? {
    for _ in 0..<2 {
      let helper = try self.helper ?? OCRHelperProcess(executable: helperURL)
      self.helper = helper
      switch await helper.recognize(job) {
      case .result(let line): return line
      case .notRunning: self.helper = nil
      case .exited:
        self.helper = nil
        return nil
      }
    }
    return nil
  }

  /// CPU seconds the running helper has used so far; finished helpers are in `getrusage(RUSAGE_CHILDREN)`.
  public func liveHelperCPUSeconds() -> Double {
    helper?.cpuSeconds() ?? 0
  }

  /// The running helper's process id, for checks.
  var helperProcessID: Int32? { helper?.processIdentifier }

  /// Closes the helper now (app quit, or the idle timeout).
  public func stopHelper() {
    idleExit?.cancel()
    helper?.finish()
    helper = nil
  }

  private func scheduleIdleExit() {
    idleExit?.cancel()
    let timeout = idleTimeout
    idleExit = Task {
      try? await Task.sleep(for: timeout)
      guard !Task.isCancelled else { return }
      stopHelper()
    }
  }
}

/// The OCR helper as a long-lived child: one JSON job per line on its input, one JSON result per line on its output.
final class OCRHelperProcess: @unchecked Sendable {
  private let process = Process()
  private let input = Pipe()
  private let output = Pipe()
  /// Bytes read past the last full line. Only `readLine` touches it, and the runner asks one job at a time.
  private var buffer = Data()

  init(executable: URL) throws {
    process.executableURL = executable
    process.standardInput = input
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    process.qualityOfService = .utility
    // The helper needs nothing from the app's environment, which can hold `OPENROUTER_API_KEY`.
    process.environment = [:]
    try process.run()
  }

  enum Outcome {
    case result(Data)
    /// The helper was gone before it took the job.
    case notRunning
    /// The helper took the job and exited without answering.
    case exited
  }

  /// Sends one job and waits for its result line.
  func recognize(_ job: Data) async -> Outcome {
    guard process.isRunning, (try? input.fileHandleForWriting.write(contentsOf: job + Data("\n".utf8))) != nil else {
      return .notRunning
    }
    return await Task.detached(priority: .utility) { self.readLine() }.value.map(Outcome.result) ?? .exited
  }

  private func readLine() -> Data? {
    while true {
      if let newline = buffer.firstIndex(of: 0x0A) {
        let line = Data(buffer[buffer.startIndex..<newline])
        buffer.removeSubrange(buffer.startIndex...newline)
        return line
      }
      let chunk = output.fileHandleForReading.availableData
      if chunk.isEmpty { return nil }
      buffer.append(chunk)
    }
  }

  /// Closes the helper's input and waits for it to exit (it finishes the job in hand, at most a fraction of a second),
  /// so its CPU is counted in `getrusage(RUSAGE_CHILDREN)` from then on.
  func finish() {
    try? input.fileHandleForWriting.close()
    process.waitUntilExit()
  }

  var processIdentifier: Int32 { process.processIdentifier }

  /// User and system CPU seconds of the helper so far.
  func cpuSeconds() -> Double {
    var info = rusage_info_v2()
    let status = withUnsafeMutablePointer(to: &info) { pointer in
      pointer.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(process.processIdentifier, RUSAGE_INFO_V2, $0) }
    }
    guard status == 0 else { return 0 }
    // The times are in Mach absolute time units, which are not nanoseconds on Apple silicon.
    var timebase = mach_timebase_info_data_t()
    mach_timebase_info(&timebase)
    return Double(info.ri_user_time + info.ri_system_time) * Double(timebase.numer) / Double(timebase.denom) / 1e9
  }
}
