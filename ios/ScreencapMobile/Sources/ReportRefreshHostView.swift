import DeviceActivity
import SwiftUI

struct ReportRefreshHostView: View {
	let dayStart: Date
	let refreshToken: String
	var minimumHeight: CGFloat = 280
	var onPresented: (() -> Void)? = nil

	var body: some View {
		let start = Calendar.current.startOfDay(for: dayStart)
		let end = Calendar.current.date(byAdding: .day, value: 1, to: start) ?? start
		DeviceActivityReport(
			DeviceActivityReport.Context("day-wrapped"),
			filter: DeviceActivityFilter(
				segment: .hourly(during: DateInterval(start: start, end: end))
			)
		)
		.frame(maxWidth: .infinity, minHeight: minimumHeight, alignment: .topLeading)
		.id(refreshToken)
		.task(id: refreshToken) {
			AppGroupStore.markReportHostPresented()
			AppGroupStore.appendLog(
				scope: "report-host",
				message:
					"presented token=\(refreshToken) dayStartMs=\(Int64(start.timeIntervalSince1970 * 1000))"
			)
			onPresented?()
		}
	}
}
