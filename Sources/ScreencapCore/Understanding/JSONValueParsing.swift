import Foundation

/// Reading JSON into `JSONValue` with object keys in their written order, so a config file edited here keeps the
/// order its owner wrote, plus the accessors and literals the MCP server builds its messages with.
extension JSONValue {
  public enum ParseError: Error, Equatable {
    case unexpected(offset: Int)
    case tooDeep
  }

  public static func parse(_ text: String) throws -> JSONValue {
    try parse(Data(text.utf8))
  }

  public static func parse(_ data: Data) throws -> JSONValue {
    var parser = Parser(bytes: [UInt8](data))
    parser.skipSpace()
    let value = try parser.value(depth: 0)
    parser.skipSpace()
    guard parser.index == parser.bytes.count else { throw ParseError.unexpected(offset: parser.index) }
    return value
  }

  /// An object of the pairs whose value is present, in order.
  public static func fields(_ pairs: [(String, JSONValue?)]) -> JSONValue {
    .object(pairs.compactMap { key, value in value.map { (key, $0) } })
  }

  public subscript(key: String) -> JSONValue? {
    guard case .object(let pairs) = self else { return nil }
    return pairs.last { $0.0 == key }?.1
  }

  public var string: String? {
    if case .string(let s) = self { return s }
    return nil
  }

  public var number: Double? {
    if case .number(let n) = self { return n }
    return nil
  }

  public var bool: Bool? {
    if case .bool(let b) = self { return b }
    return nil
  }

  public var array: [JSONValue]? {
    if case .array(let items) = self { return items }
    return nil
  }

  public var pairs: [(String, JSONValue)]? {
    if case .object(let pairs) = self { return pairs }
    return nil
  }

  /// This object with `key` set to `value` in place (appended when new), or removed when `value` is nil.
  public func setting(_ key: String, to value: JSONValue?) -> JSONValue {
    var pairs = self.pairs ?? []
    if let index = pairs.firstIndex(where: { $0.0 == key }) {
      if let value { pairs[index].1 = value } else { pairs.remove(at: index) }
    } else if let value {
      pairs.append((key, value))
    }
    return .object(pairs)
  }

  /// Indented with two spaces, as people and most apps write their config files.
  public func pretty() -> String {
    var out = ""
    writePretty(into: &out, level: 0)
    return out
  }

  func writePretty(into out: inout String, level: Int) {
    let indent = String(repeating: "  ", count: level + 1)
    let closing = String(repeating: "  ", count: level)
    switch self {
    case .array(let items) where !items.isEmpty:
      out += "[\n"
      for (i, item) in items.enumerated() {
        out += indent
        item.writePretty(into: &out, level: level + 1)
        out += i < items.count - 1 ? ",\n" : "\n"
      }
      out += closing + "]"
    case .object(let pairs) where !pairs.isEmpty:
      out += "{\n"
      for (i, (key, value)) in pairs.enumerated() {
        out += indent
        Self.writeString(key, into: &out)
        out += ": "
        value.writePretty(into: &out, level: level + 1)
        out += i < pairs.count - 1 ? ",\n" : "\n"
      }
      out += closing + "}"
    default:
      write(into: &out)
    }
  }

  struct Parser {
    let bytes: [UInt8]
    var index = 0

    /// Deeper nesting than any real message or config, and shallow enough that recursion cannot exhaust the stack.
    static let maxDepth = 256

    mutating func skipSpace() {
      while index < bytes.count, [0x20, 0x0A, 0x0D, 0x09].contains(bytes[index]) { index += 1 }
    }

    mutating func value(depth: Int) throws -> JSONValue {
      guard depth < Self.maxDepth else { throw ParseError.tooDeep }
      guard index < bytes.count else { throw ParseError.unexpected(offset: index) }
      switch bytes[index] {
      case UInt8(ascii: "{"): return try object(depth: depth)
      case UInt8(ascii: "["): return try array(depth: depth)
      case UInt8(ascii: "\""): return .string(try string())
      case UInt8(ascii: "t"): return try literal("true", .bool(true))
      case UInt8(ascii: "f"): return try literal("false", .bool(false))
      case UInt8(ascii: "n"): return try literal("null", .null)
      default: return try number()
      }
    }

    mutating func literal(_ word: String, _ value: JSONValue) throws -> JSONValue {
      let utf8 = Array(word.utf8)
      guard index + utf8.count <= bytes.count, Array(bytes[index..<index + utf8.count]) == utf8 else {
        throw ParseError.unexpected(offset: index)
      }
      index += utf8.count
      return value
    }

    mutating func object(depth: Int) throws -> JSONValue {
      index += 1
      var pairs: [(String, JSONValue)] = []
      skipSpace()
      if index < bytes.count, bytes[index] == UInt8(ascii: "}") {
        index += 1
        return .object(pairs)
      }
      while true {
        skipSpace()
        guard index < bytes.count, bytes[index] == UInt8(ascii: "\"") else { throw ParseError.unexpected(offset: index) }
        let key = try string()
        skipSpace()
        guard index < bytes.count, bytes[index] == UInt8(ascii: ":") else { throw ParseError.unexpected(offset: index) }
        index += 1
        skipSpace()
        pairs.append((key, try value(depth: depth + 1)))
        skipSpace()
        guard index < bytes.count else { throw ParseError.unexpected(offset: index) }
        if bytes[index] == UInt8(ascii: ",") {
          index += 1
          continue
        }
        guard bytes[index] == UInt8(ascii: "}") else { throw ParseError.unexpected(offset: index) }
        index += 1
        return .object(pairs)
      }
    }

    mutating func array(depth: Int) throws -> JSONValue {
      index += 1
      var items: [JSONValue] = []
      skipSpace()
      if index < bytes.count, bytes[index] == UInt8(ascii: "]") {
        index += 1
        return .array(items)
      }
      while true {
        skipSpace()
        items.append(try value(depth: depth + 1))
        skipSpace()
        guard index < bytes.count else { throw ParseError.unexpected(offset: index) }
        if bytes[index] == UInt8(ascii: ",") {
          index += 1
          continue
        }
        guard bytes[index] == UInt8(ascii: "]") else { throw ParseError.unexpected(offset: index) }
        index += 1
        return .array(items)
      }
    }

    mutating func string() throws -> String {
      index += 1
      var out: [UInt8] = []
      while index < bytes.count {
        let byte = bytes[index]
        index += 1
        switch byte {
        case UInt8(ascii: "\""):
          return String(decoding: out, as: UTF8.self)
        case UInt8(ascii: "\\"):
          guard index < bytes.count else { throw ParseError.unexpected(offset: index) }
          let escape = bytes[index]
          index += 1
          switch escape {
          case UInt8(ascii: "\""), UInt8(ascii: "\\"), UInt8(ascii: "/"): out.append(escape)
          case UInt8(ascii: "b"): out.append(0x08)
          case UInt8(ascii: "f"): out.append(0x0C)
          case UInt8(ascii: "n"): out.append(0x0A)
          case UInt8(ascii: "r"): out.append(0x0D)
          case UInt8(ascii: "t"): out.append(0x09)
          case UInt8(ascii: "u"):
            var scalar = try hex4()
            // A high surrogate followed by an escaped low surrogate is one character outside the BMP.
            if (0xD800..<0xDC00).contains(scalar), index + 1 < bytes.count, bytes[index] == UInt8(ascii: "\\"),
              bytes[index + 1] == UInt8(ascii: "u")
            {
              let saved = index
              index += 2
              let low = try hex4()
              if (0xDC00..<0xE000).contains(low) {
                scalar = 0x10000 + ((scalar - 0xD800) << 10) + (low - 0xDC00)
              } else {
                index = saved
              }
            }
            out.append(contentsOf: Array(String(Unicode.Scalar(scalar).map(Character.init) ?? "\u{FFFD}").utf8))
          default:
            throw ParseError.unexpected(offset: index - 1)
          }
        case 0x00..<0x20:
          throw ParseError.unexpected(offset: index - 1)
        default:
          out.append(byte)
        }
      }
      throw ParseError.unexpected(offset: index)
    }

    mutating func hex4() throws -> UInt32 {
      guard index + 4 <= bytes.count, let value = UInt32(String(decoding: bytes[index..<index + 4], as: UTF8.self), radix: 16)
      else { throw ParseError.unexpected(offset: index) }
      index += 4
      return value
    }

    mutating func number() throws -> JSONValue {
      let start = index
      while index < bytes.count, "+-0123456789.eE".utf8.contains(bytes[index]) { index += 1 }
      guard index > start, let value = Double(String(decoding: bytes[start..<index], as: UTF8.self)) else {
        throw ParseError.unexpected(offset: start)
      }
      return .number(value)
    }
  }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral,
  ExpressibleByBooleanLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral
{
  public init(stringLiteral value: String) { self = .string(value) }
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
  public init(floatLiteral value: Double) { self = .number(value) }
  public init(booleanLiteral value: Bool) { self = .bool(value) }
  public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
  public init(dictionaryLiteral elements: (String, JSONValue)...) { self = .object(elements) }
}
