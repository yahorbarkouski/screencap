import DeviceActivity
import ManagedSettings
import SwiftUI

private struct DayWrappedReportPayload {
	let snapshot: DayWrappedSnapshot
}

@main
struct ScreencapMobileReportExtension: DeviceActivityReportExtension {
	var body: some DeviceActivityReportScene {
		DayWrappedReportScene()
	}
}

private struct DayWrappedReportScene: DeviceActivityReportScene {
	let context = DeviceActivityReport.Context("day-wrapped")
	let content: (DayWrappedReportPayload) -> DayWrappedReportContentView = { payload in
		DayWrappedReportContentView(payload: payload)
	}

	func makeConfiguration(
		representing data: DeviceActivityResults<DeviceActivityData>
	) async -> DayWrappedReportPayload {
		return await DayWrappedReportBuilder.build(from: data)
	}
}

private struct DayWrappedReportContentView: View {
	let payload: DayWrappedReportPayload

	var body: some View {
		DayWrappedCardView(snapshot: payload.snapshot, style: .app)
	}
}

private enum DayWrappedReportBuilder {
	private struct AppKey: Hashable {
		let name: String
		let bundleId: String?
	}

	private struct HourAccumulator {
		var categoryDurations: [WrappedCategory: Int] = [:]
		var rawCategoryDurations: [String: Int] = [:]
		var appDurations: [AppKey: Int] = [:]
		var appPickups: [AppKey: Int] = [:]
		var appNotifications: [AppKey: Int] = [:]
		var domainDurations: [String: Int] = [:]
	}

	static func build(from results: DeviceActivityResults<DeviceActivityData>) async -> DayWrappedReportPayload {
		AppGroupStore.markReportStarted()
		let calendar = Calendar.current
		let requestedDayStartMs = AppGroupStore.latestRequestedDayStartMs()
		let defaultDayStart: Date = {
			if requestedDayStartMs > 0 {
				return Date(timeIntervalSince1970: TimeInterval(requestedDayStartMs) / 1000)
			}
			return calendar.startOfDay(for: Date())
		}()
		var dayStart = defaultDayStart
		var hours: [Int: HourAccumulator] = [:]

		for await data in results {
			switch data.segmentInterval {
			case let .hourly(during: interval):
				dayStart = calendar.startOfDay(for: interval.start)
			case let .daily(during: interval):
				dayStart = calendar.startOfDay(for: interval.start)
			case let .weekly(during: interval):
				dayStart = calendar.startOfDay(for: interval.start)
			@unknown default:
				dayStart = defaultDayStart
			}

			for await segment in data.activitySegments {
				let hour = calendar.component(.hour, from: segment.dateInterval.start)
				var accumulator = hours[hour] ?? HourAccumulator()

				for await categoryActivity in segment.categories {
					let category = mapCategory(from: categoryActivity.category)
					let rawCategory = categoryActivity.category.localizedDisplayName ?? category.rawValue
					accumulator.categoryDurations[category, default: 0] += Int(categoryActivity.totalActivityDuration)
					accumulator.rawCategoryDurations[rawCategory, default: 0] += Int(categoryActivity.totalActivityDuration)

					for await appActivity in categoryActivity.applications {
						let appName = normalizeAppName(
							appActivity.application.localizedDisplayName
								?? appActivity.application.bundleIdentifier
								?? "Unknown"
						)
						let key = AppKey(
							name: appName,
							bundleId: appActivity.application.bundleIdentifier
						)
						accumulator.appDurations[key, default: 0] += Int(appActivity.totalActivityDuration)
						accumulator.appPickups[key, default: 0] += appActivity.numberOfPickups
						accumulator.appNotifications[key, default: 0] += appActivity.numberOfNotifications
					}

					for await domainActivity in categoryActivity.webDomains {
						let domain =
							domainActivity.webDomain.domain?
							.trimmingCharacters(in: .whitespacesAndNewlines)
							.lowercased() ?? ""
						guard !domain.isEmpty else { continue }
						accumulator.domainDurations[domain, default: 0] += Int(domainActivity.totalActivityDuration)
					}
				}

				hours[hour] = accumulator
			}
		}

		let dayStartMs = Int64(dayStart.timeIntervalSince1970 * 1000)
		let syncedAt = Int64(Date().timeIntervalSince1970 * 1000)
		let buckets = (0 ..< 24).compactMap { hour -> MobileActivityHourBucket? in
			guard let accumulator = hours[hour] else { return nil }
			let totalDuration =
				accumulator.appDurations.values.max()
				?? accumulator.domainDurations.values.max()
				?? accumulator.categoryDurations.values.max()
				?? 0
			guard totalDuration > 0 else { return nil }

			let category = accumulator.categoryDurations.max { lhs, rhs in
				lhs.value < rhs.value
			}?.key ?? .unknown
			let rawCategory = accumulator.rawCategoryDurations.max { lhs, rhs in
				lhs.value < rhs.value
			}?.key
			let dominantApp = accumulator.appDurations.max { lhs, rhs in
				lhs.value < rhs.value
			}?.key
			let dominantDomain = accumulator.domainDurations.max { lhs, rhs in
				lhs.value < rhs.value
			}?.key
			let apps = accumulator.appDurations
				.map { key, duration in
					MobileActivityBucketApp(
						name: key.name,
						bundleId: key.bundleId,
						durationSeconds: duration,
						numberOfPickups: accumulator.appPickups[key],
						numberOfNotifications: accumulator.appNotifications[key]
					)
				}
				.sorted { lhs, rhs in
					if lhs.durationSeconds == rhs.durationSeconds {
						return lhs.name < rhs.name
					}
					return lhs.durationSeconds > rhs.durationSeconds
				}
			let domains = accumulator.domainDurations
				.map { domain, duration in
					MobileActivityBucketDomain(domain: domain, durationSeconds: duration)
				}
				.sorted { lhs, rhs in
					if lhs.durationSeconds == rhs.durationSeconds {
						return lhs.domain < rhs.domain
					}
					return lhs.durationSeconds > rhs.durationSeconds
				}

			return MobileActivityHourBucket(
				hour: hour,
				durationSeconds: totalDuration,
				category: category,
				appName: dominantDomain != nil && isBrowserApp(named: dominantApp?.name)
					? dominantDomain
					: dominantApp?.name,
				appBundleId: dominantApp?.bundleId,
				domain: dominantDomain,
				rawCategory: rawCategory,
				apps: apps.isEmpty ? nil : apps,
				domains: domains.isEmpty ? nil : domains,
				caption: nil,
				confidence: nil,
				classificationSource: "screen_time"
			)
		}

		let day = MobileActivityDay(
			deviceId: AuthStore.loadIdentity()?.deviceId ?? "ios-unpaired",
			deviceName: "iPhone",
			platform: "ios",
			dayStartMs: dayStartMs,
			buckets: buckets,
			syncedAt: syncedAt
		)
		do {
			try AppGroupStore.saveMobileDay(day)
			AppGroupStore.appendLog(
				scope: "report",
				message:
					"produced mobile day dayStartMs=\(dayStartMs) buckets=\(buckets.count)"
			)
		} catch {
			AppGroupStore.markReportError(error.localizedDescription)
			AppGroupStore.appendLog(
				scope: "report",
				message:
					"failed to save mobile day dayStartMs=\(dayStartMs) error=\(error.localizedDescription)"
			)
		}
		if AuthStore.loadIdentity() != nil {
			Task.detached(priority: .background) {
				do {
					try await BackendClient.upload(day: day)
					AppGroupStore.appendLog(
						scope: "report",
						message:
							"direct upload from report extension succeeded dayStartMs=\(dayStartMs)"
					)
				} catch {
					AppGroupStore.appendLog(
						scope: "report",
						message:
							"direct upload from report extension failed dayStartMs=\(dayStartMs) error=\(error.localizedDescription)"
					)
				}
			}
		}
		let macSnapshot =
			AppGroupStore.loadCachedSnapshot(dayStartMs: dayStartMs)
			?? AppGroupStore.loadSnapshot()
		let snapshot = DayWrappedRendering.composeMergedSnapshot(
			macSnapshot: macSnapshot?.dayStartMs == dayStartMs ? macSnapshot : nil,
			iphoneDay: day
		)
		return DayWrappedReportPayload(snapshot: snapshot)
	}

	private static func normalizeAppName(_ value: String) -> String {
		let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
		return trimmed.isEmpty ? "Unknown" : trimmed
	}

	private static func isBrowserApp(named value: String?) -> Bool {
		let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
		guard !normalized.isEmpty else { return false }
		return normalized.contains("safari")
			|| normalized.contains("chrome")
			|| normalized.contains("firefox")
			|| normalized.contains("arc")
			|| normalized.contains("brave")
			|| normalized.contains("edge")
			|| normalized.contains("opera")
			|| normalized.contains("duckduckgo")
	}

	private static func mapCategory(from category: ManagedSettings.ActivityCategory) -> WrappedCategory {
		let label = category.localizedDisplayName?.lowercased() ?? ""
		if label.contains("social") || label.contains("communication") || label.contains("message") {
			return .social
		}
		if label.contains("education") || label.contains("reference") || label.contains("book") {
			return .study
		}
		if label.contains("productivity") || label.contains("business") || label.contains("developer") {
			return .work
		}
		if label.contains("shopping") || label.contains("finance") || label.contains("food") || label.contains("travel") || label.contains("utility") {
			return .chores
		}
		if label.contains("game") || label.contains("entertainment") || label.contains("music") || label.contains("video") || label.contains("photo") {
			return .leisure
		}
		return .unknown
	}
}
