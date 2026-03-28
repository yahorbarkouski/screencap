import DeviceActivity
import SwiftUI

struct ReportRefreshHostView: View {
	let dayStart: Date
	let refreshToken: String

	var body: some View {
		let start = Calendar.current.startOfDay(for: dayStart)
		let end = Calendar.current.date(byAdding: .day, value: 1, to: start) ?? start
		DeviceActivityReport(
			DeviceActivityReport.Context("day-wrapped"),
			filter: DeviceActivityFilter(
				segment: .hourly(during: DateInterval(start: start, end: end)),
				devices: .init([.iPhone])
			)
		)
		.id(refreshToken)
		.task(id: refreshToken) {
			AppGroupStore.markReportHostPresented()
			AppGroupStore.appendLog(
				scope: "report-host",
				message: "presented token=\(refreshToken) dayStartMs=\(Int64(start.timeIntervalSince1970 * 1000))"
			)
		}
	}
}
