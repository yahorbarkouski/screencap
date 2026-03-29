import AppIntents
import Foundation
import WidgetKit

struct PreviousWidgetDayIntent: AppIntent {
	static var title: LocalizedStringResource = "Previous Day"

	func perform() async throws -> some IntentResult {
		await WidgetDayNavigator.navigate(dayOffset: -1)
		return .result()
	}
}

struct NextWidgetDayIntent: AppIntent {
	static var title: LocalizedStringResource = "Next Day"

	func perform() async throws -> some IntentResult {
		await WidgetDayNavigator.navigate(dayOffset: 1)
		return .result()
	}
}

private enum WidgetDayNavigator {
	static func navigate(dayOffset: Int) async {
		let currentDayStartMs =
			AppGroupStore.loadWidgetSelectedDayStartMs()
			?? AppGroupStore.loadSnapshot()?.dayStartMs
			?? startOfDayMs(for: Date())
		let calendar = Calendar.current
		let currentDate = Date(timeIntervalSince1970: TimeInterval(currentDayStartMs) / 1000)
		let shiftedDate =
			calendar.date(byAdding: .day, value: dayOffset, to: currentDate)
			?? currentDate
		let candidateDate = min(
			calendar.startOfDay(for: shiftedDate),
			calendar.startOfDay(for: Date())
		)
		let candidateDayStartMs = startOfDayMs(for: candidateDate)

		guard candidateDayStartMs != currentDayStartMs else {
			WidgetCenter.shared.reloadTimelines(ofKind: "ScreencapMobileWidget")
			return
		}

		AppGroupStore.saveWidgetSelectedDayStartMs(candidateDayStartMs)
		AppGroupStore.appendLog(
			scope: "widget-day",
			message: "navigating widget to dayStartMs=\(candidateDayStartMs)"
		)

		if AppGroupStore.loadCachedSnapshot(dayStartMs: candidateDayStartMs) == nil {
			if case .missingKeyMaterial = AuthStore.loadSignedRequestCredentials() {
				AppGroupStore.appendLog(
					scope: "widget-day",
					message:
						"widget fetch is missing shared signing keys; open the iPhone app once to refresh shared credentials"
				)
			}
			do {
				let snapshot = try await BackendClient.fetchSnapshot(dayStartMs: candidateDayStartMs)
				try AppGroupStore.saveCachedSnapshot(snapshot)
				AppGroupStore.appendLog(
					scope: "widget-day",
					message: "fetched widget snapshot dayStartMs=\(snapshot.dayStartMs)"
				)
			} catch {
				AppGroupStore.saveWidgetSelectedDayStartMs(currentDayStartMs)
				AppGroupStore.appendLog(
					scope: "widget-day",
					message:
						"failed widget navigation fetch dayStartMs=\(candidateDayStartMs) error=\(error.localizedDescription)"
				)
			}
		}

		WidgetCenter.shared.reloadTimelines(ofKind: "ScreencapMobileWidget")
	}

	private static func startOfDayMs(for date: Date) -> Int64 {
		Int64(Calendar.current.startOfDay(for: date).timeIntervalSince1970 * 1000)
	}
}
