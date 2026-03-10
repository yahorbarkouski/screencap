import DeviceActivity
import ManagedSettings
import SwiftUI

private struct DayWrappedReportPayload {
	let day: MobileActivityDay
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
		await DayWrappedReportBuilder.build(from: data)
	}
}

private struct DayWrappedReportContentView: View {
	let payload: DayWrappedReportPayload

	var body: some View {
		Color.clear
			.task(id: payload.day.syncedAt) {
				try? AppGroupStore.saveMobileDay(payload.day)
			}
	}
}

private enum DayWrappedReportBuilder {
	private struct HourAccumulator {
		var categoryDurations: [WrappedCategory: Int] = [:]
		var appDurations: [String: Int] = [:]
	}

	static func build(from results: DeviceActivityResults<DeviceActivityData>) async -> DayWrappedReportPayload {
		let calendar = Calendar.current
		let defaultDayStart = calendar.startOfDay(for: Date())
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
				dayStart = calendar.startOfDay(for: Date())
			}

			for await segment in data.activitySegments {
				let hour = calendar.component(.hour, from: segment.dateInterval.start)
				var accumulator = hours[hour] ?? HourAccumulator()

				for await categoryActivity in segment.categories {
					let category = mapCategory(from: categoryActivity.category)
					accumulator.categoryDurations[category, default: 0] += Int(categoryActivity.totalActivityDuration)

					for await appActivity in categoryActivity.applications {
						let appName =
							appActivity.application.localizedDisplayName
							?? appActivity.application.bundleIdentifier
							?? "Unknown"
						accumulator.appDurations[appName, default: 0] += Int(appActivity.totalActivityDuration)
					}
				}

				hours[hour] = accumulator
			}
		}

		let dayStartMs = Int64(dayStart.timeIntervalSince1970 * 1000)
		let syncedAt = Int64(Date().timeIntervalSince1970 * 1000)
		let buckets = (0 ..< 24).compactMap { hour -> MobileActivityHourBucket? in
			guard let accumulator = hours[hour] else { return nil }
			let totalDuration = accumulator.appDurations.values.max() ?? accumulator.categoryDurations.values.max() ?? 0
			guard totalDuration > 0 else { return nil }

			let category = accumulator.categoryDurations.max { lhs, rhs in
				lhs.value < rhs.value
			}?.key ?? .unknown
			let appName = accumulator.appDurations.max { lhs, rhs in
				lhs.value < rhs.value
			}?.key

			return MobileActivityHourBucket(
				hour: hour,
				durationSeconds: totalDuration,
				category: category,
				appName: appName
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
		return DayWrappedReportPayload(day: day)
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
