import Foundation
import SwiftUI

enum WrappedMode: String, Codable, CaseIterable, Sendable {
	case categories
	case apps

	var nextWidgetMode: WrappedMode {
		switch self {
		case .categories:
			return .apps
		case .apps:
			return .categories
		}
	}
}

enum WrappedSourceFilter: String, Codable, CaseIterable, Sendable {
	case both
	case mac
	case iphone

	var nextWidgetSourceFilter: WrappedSourceFilter {
		switch self {
		case .both:
			return .mac
		case .mac:
			return .iphone
		case .iphone:
			return .both
		}
	}

	var label: String {
		switch self {
		case .both:
			return "Both"
		case .mac:
			return "Mac"
		case .iphone:
			return "iPhone"
		}
	}

	var iconName: String {
		switch self {
		case .both:
			return "rectangle.on.rectangle"
		case .mac:
			return "desktopcomputer"
		case .iphone:
			return "iphone.gen3"
		}
	}
}

enum WrappedSourceAccent: String, Codable, Hashable, Sendable {
	case none
	case mac
	case iphone
	case both
}

enum WrappedCategory: String, Codable, CaseIterable, Hashable, Sendable {
	case study = "Study"
	case work = "Work"
	case leisure = "Leisure"
	case chores = "Chores"
	case social = "Social"
	case unknown = "Unknown"

	var color: Color {
		switch self {
		case .study:
			return Color(red: 59.0 / 255.0, green: 130.0 / 255.0, blue: 246.0 / 255.0)
		case .work:
			return Color(red: 34.0 / 255.0, green: 197.0 / 255.0, blue: 94.0 / 255.0)
		case .leisure:
			return Color(red: 168.0 / 255.0, green: 85.0 / 255.0, blue: 247.0 / 255.0)
		case .chores:
			return Color(red: 250.0 / 255.0, green: 204.0 / 255.0, blue: 21.0 / 255.0)
		case .social:
			return Color(red: 236.0 / 255.0, green: 72.0 / 255.0, blue: 153.0 / 255.0)
		case .unknown:
			return Color(red: 107.0 / 255.0, green: 114.0 / 255.0, blue: 128.0 / 255.0)
		}
	}
}

struct DeviceIdentity: Codable, Hashable, Sendable {
	let userId: String
	let deviceId: String
	let username: String
	let signPubKeySpkiDerB64: String
	let dhPubKeySpkiDerB64: String
	let backendBaseURL: String
}

struct StoredKeyMaterial: Codable, Hashable, Sendable {
	let signPrivateKeyRawB64: String
	let dhPrivateKeyRawB64: String
}

struct PairingLink: Hashable, Sendable {
	let baseURL: URL
	let sessionId: String
	let code: String?

	static func parse(_ raw: String, defaultBaseURL: URL) -> PairingLink? {
		let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else {
			return nil
		}

		if let url = URL(string: trimmed), url.scheme != nil, url.host != nil {
			let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
			let sessionId =
				components?.queryItems?.first(where: { $0.name == "sessionId" })?.value
				?? components?.queryItems?.first(where: { $0.name == "session" })?.value
				?? url.pathComponents.last(where: { $0 != "/" }) ?? ""
			guard !sessionId.isEmpty else {
				return nil
			}
			let baseURL = URL(string: "\(url.scheme ?? "https")://\(url.host ?? "")\(url.port.map { ":\($0)" } ?? "")") ?? defaultBaseURL
			return PairingLink(
				baseURL: baseURL,
				sessionId: sessionId,
				code: components?.queryItems?.first(where: { $0.name == "code" })?.value
			)
		}

		return nil
	}
}

struct PairingClaimRequest: Codable, Sendable {
	let code: String?
	let deviceName: String
	let platform: String
	let signPubKey: String
	let dhPubKey: String
}

struct PairingClaimResponse: Codable, Sendable {
	let userId: String
	let deviceId: String
	let username: String
}

struct MobileActivityBucketApp: Codable, Hashable, Sendable {
	let name: String
	let bundleId: String?
	let durationSeconds: Int
	let numberOfPickups: Int?
	let numberOfNotifications: Int?
}

struct MobileActivityBucketDomain: Codable, Hashable, Sendable {
	let domain: String
	let durationSeconds: Int
}

struct MobileActivityHourBucket: Codable, Hashable, Sendable {
	let hour: Int
	let durationSeconds: Int
	let category: WrappedCategory
	let appName: String?
	let appBundleId: String?
	let domain: String?
	let rawCategory: String?
	let apps: [MobileActivityBucketApp]?
	let domains: [MobileActivityBucketDomain]?
	let caption: String?
	let confidence: Double?
	let classificationSource: String?

	init(
		hour: Int,
		durationSeconds: Int,
		category: WrappedCategory,
		appName: String?,
		appBundleId: String? = nil,
		domain: String? = nil,
		rawCategory: String? = nil,
		apps: [MobileActivityBucketApp]? = nil,
		domains: [MobileActivityBucketDomain]? = nil,
		caption: String? = nil,
		confidence: Double? = nil,
		classificationSource: String? = nil
	) {
		self.hour = hour
		self.durationSeconds = durationSeconds
		self.category = category
		self.appName = appName
		self.appBundleId = appBundleId
		self.domain = domain
		self.rawCategory = rawCategory
		self.apps = apps
		self.domains = domains
		self.caption = caption
		self.confidence = confidence
		self.classificationSource = classificationSource
	}
}

struct MobileActivityDay: Codable, Hashable, Sendable {
	let deviceId: String
	let deviceName: String?
	let platform: String
	let dayStartMs: Int64
	let buckets: [MobileActivityHourBucket]
	let syncedAt: Int64
}

struct WrappedSlot: Codable, Hashable, Identifiable, Sendable {
	let id: Int
	let startMs: Int64
	let count: Int
	let category: WrappedCategory
	let appName: String?
	let source: WrappedSourceAccent
	let macCount: Int
	let iphoneCount: Int

	private enum CodingKeys: String, CodingKey {
		case id
		case startMs
		case count
		case category
		case appName
		case source
		case macCount
		case iphoneCount
	}

	init(
		id: Int,
		startMs: Int64,
		count: Int,
		category: WrappedCategory,
		appName: String?,
		source: WrappedSourceAccent,
		macCount: Int,
		iphoneCount: Int
	) {
		self.id = id
		self.startMs = startMs
		self.count = count
		self.category = category
		self.appName = appName
		self.source = source
		self.macCount = macCount
		self.iphoneCount = iphoneCount
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		startMs = try container.decode(Int64.self, forKey: .startMs)
		count = try container.decode(Int.self, forKey: .count)
		category = try container.decode(WrappedCategory.self, forKey: .category)
		appName = try container.decodeIfPresent(String.self, forKey: .appName)
		source = try container.decode(WrappedSourceAccent.self, forKey: .source)
		macCount = try container.decode(Int.self, forKey: .macCount)
		iphoneCount = try container.decode(Int.self, forKey: .iphoneCount)
		id =
			try container.decodeIfPresent(Int.self, forKey: .id)
			?? Int(startMs / Int64(10 * 60 * 1000))
	}
}

struct DayWrappedSnapshot: Codable, Hashable, Sendable {
	let dayStartMs: Int64
	let title: String
	let subtitle: String
	let updatedAtMs: Int64
	let sourceSummary: String
	let pairedDeviceName: String?
	let mode: WrappedMode
	let slots: [WrappedSlot]
}

struct BridgeDiagnosticsResponse: Codable, Hashable, Sendable {
	let ok: Bool
	let requestedDayStartMs: Int64
	let probeToken: String?
	let echoedProbeToken: String?
	let serverNowMs: Int64
	let advertisedBaseURL: String?
	let userId: String
	let username: String
	let pairedDeviceId: String
	let pairedDeviceName: String
	let cachedDaysForDevice: Int
	let cachedDaysForRequestedDay: Int
	let cachedDayStartMsForDevice: [Int64]
	let latestCachedDayStartMs: Int64?
	let latestCachedDaySyncedAt: Int64?
	let requestedDayBucketCount: Int?
	let eventCountForRequestedDay: Int
	let snapshotSourceSummary: String
	let activeSlotCount: Int
	let bridgeLogTail: String
}

struct SyncDiagnostics: Codable, Hashable, Sendable {
	var requestedToken: String
	var requestedDayStartMs: Int64
	var requestedAtMs: Int64?
	var reportHostPresentedAtMs: Int64?
	var reportStartedAtMs: Int64?
	var reportFinishedAtMs: Int64?
	var producedDayStartMs: Int64?
	var producedBucketCount: Int?
	var lastReportError: String?
	var snapshotSavedAtMs: Int64?
	var snapshotDayStartMs: Int64?
	var lastManualMacSyncAtMs: Int64?
	var lastAutoMacSyncAtMs: Int64?
	var lastMacSyncError: String?
	var lastUploadAttemptAtMs: Int64?
	var lastUploadSuccessAtMs: Int64?
	var lastUploadError: String?
	var lastBridgeProbeAtMs: Int64?
	var lastBridgeProbeToken: String?
	var lastBridgeProbeEchoToken: String?
	var lastBridgeProbeError: String?
	var lastBridgeCachedDaysForRequestedDay: Int?
	var lastBridgeCachedDayStarts: [Int64]?
	var lastBridgeRequestedDayBucketCount: Int?
	var lastBridgeEventCountForRequestedDay: Int?
	var lastBridgeActiveSlotCount: Int?
	var lastBridgeSourceSummary: String?
	var lastBridgeLogTail: String?
	var lastRepairStartedAtMs: Int64?
	var lastRepairCompletedAtMs: Int64?
	var lastRepairError: String?

	init(
		requestedToken: String = "",
		requestedDayStartMs: Int64 = 0,
		requestedAtMs: Int64? = nil,
		reportHostPresentedAtMs: Int64? = nil,
		reportStartedAtMs: Int64? = nil,
		reportFinishedAtMs: Int64? = nil,
		producedDayStartMs: Int64? = nil,
		producedBucketCount: Int? = nil,
		lastReportError: String? = nil,
		snapshotSavedAtMs: Int64? = nil,
		snapshotDayStartMs: Int64? = nil,
		lastManualMacSyncAtMs: Int64? = nil,
		lastAutoMacSyncAtMs: Int64? = nil,
		lastMacSyncError: String? = nil,
		lastUploadAttemptAtMs: Int64? = nil,
		lastUploadSuccessAtMs: Int64? = nil,
		lastUploadError: String? = nil,
		lastBridgeProbeAtMs: Int64? = nil,
		lastBridgeProbeToken: String? = nil,
		lastBridgeProbeEchoToken: String? = nil,
		lastBridgeProbeError: String? = nil,
		lastBridgeCachedDaysForRequestedDay: Int? = nil,
		lastBridgeCachedDayStarts: [Int64]? = nil,
		lastBridgeRequestedDayBucketCount: Int? = nil,
		lastBridgeEventCountForRequestedDay: Int? = nil,
		lastBridgeActiveSlotCount: Int? = nil,
		lastBridgeSourceSummary: String? = nil,
		lastBridgeLogTail: String? = nil,
		lastRepairStartedAtMs: Int64? = nil,
		lastRepairCompletedAtMs: Int64? = nil,
		lastRepairError: String? = nil
	) {
		self.requestedToken = requestedToken
		self.requestedDayStartMs = requestedDayStartMs
		self.requestedAtMs = requestedAtMs
		self.reportHostPresentedAtMs = reportHostPresentedAtMs
		self.reportStartedAtMs = reportStartedAtMs
		self.reportFinishedAtMs = reportFinishedAtMs
		self.producedDayStartMs = producedDayStartMs
		self.producedBucketCount = producedBucketCount
		self.lastReportError = lastReportError
		self.snapshotSavedAtMs = snapshotSavedAtMs
		self.snapshotDayStartMs = snapshotDayStartMs
		self.lastManualMacSyncAtMs = lastManualMacSyncAtMs
		self.lastAutoMacSyncAtMs = lastAutoMacSyncAtMs
		self.lastMacSyncError = lastMacSyncError
		self.lastUploadAttemptAtMs = lastUploadAttemptAtMs
		self.lastUploadSuccessAtMs = lastUploadSuccessAtMs
		self.lastUploadError = lastUploadError
		self.lastBridgeProbeAtMs = lastBridgeProbeAtMs
		self.lastBridgeProbeToken = lastBridgeProbeToken
		self.lastBridgeProbeEchoToken = lastBridgeProbeEchoToken
		self.lastBridgeProbeError = lastBridgeProbeError
		self.lastBridgeCachedDaysForRequestedDay = lastBridgeCachedDaysForRequestedDay
		self.lastBridgeCachedDayStarts = lastBridgeCachedDayStarts
		self.lastBridgeRequestedDayBucketCount = lastBridgeRequestedDayBucketCount
		self.lastBridgeEventCountForRequestedDay = lastBridgeEventCountForRequestedDay
		self.lastBridgeActiveSlotCount = lastBridgeActiveSlotCount
		self.lastBridgeSourceSummary = lastBridgeSourceSummary
		self.lastBridgeLogTail = lastBridgeLogTail
		self.lastRepairStartedAtMs = lastRepairStartedAtMs
		self.lastRepairCompletedAtMs = lastRepairCompletedAtMs
		self.lastRepairError = lastRepairError
	}
}
