import Foundation

/// JSON with ordered objects. Choice options reach the decision model in the order written (threads by age, `new`
/// last), which Swift dictionaries would not keep.
public indirect enum JSONValue: Sendable, Hashable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  case array([JSONValue])
  case object([(String, JSONValue)])

  public static func == (a: JSONValue, b: JSONValue) -> Bool { a.serialized() == b.serialized() }
  public func hash(into hasher: inout Hasher) { hasher.combine(serialized()) }

  public func serialized() -> String {
    var out = ""
    write(into: &out)
    return out
  }

  public var data: Data { Data(serialized().utf8) }

  func write(into out: inout String) {
    switch self {
    case .string(let s): Self.writeString(s, into: &out)
    case .number(let n):
      if n.rounded() == n, abs(n) < 1e15 { out += String(Int64(n)) } else { out += String(n) }
    case .bool(let b): out += b ? "true" : "false"
    case .null: out += "null"
    case .array(let items):
      out += "["
      for (i, item) in items.enumerated() {
        if i > 0 { out += "," }
        item.write(into: &out)
      }
      out += "]"
    case .object(let pairs):
      out += "{"
      for (i, (key, value)) in pairs.enumerated() {
        if i > 0 { out += "," }
        Self.writeString(key, into: &out)
        out += ":"
        value.write(into: &out)
      }
      out += "}"
    }
  }

  static func writeString(_ s: String, into out: inout String) {
    out += "\""
    for scalar in s.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      case _ where scalar.value < 0x20: out += String(format: "\\u%04x", scalar.value)
      default: out.unicodeScalars.append(scalar)
      }
    }
    out += "\""
  }
}
