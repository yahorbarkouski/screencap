import Foundation
import SwiftUI

enum DayWrappedRendering {
	static let slicesPerHour = 6
	static let slotsPerDay = 24 * slicesPerHour
	static let dotAlphaByLevel: [Double] = [0, 0.14, 0.24, 0.38, 0.56]
	private static let appColorPalette: [(Double, Double, Double)] = [
		(59.0 / 255.0, 130.0 / 255.0, 246.0 / 255.0),
		(34.0 / 255.0, 197.0 / 255.0, 94.0 / 255.0),
		(168.0 / 255.0, 85.0 / 255.0, 247.0 / 255.0),
		(236.0 / 255.0, 72.0 / 255.0, 153.0 / 255.0),
		(245.0 / 255.0, 158.0 / 255.0, 11.0 / 255.0),
		(6.0 / 255.0, 182.0 / 255.0, 212.0 / 255.0),
		(239.0 / 255.0, 68.0 / 255.0, 68.0 / 255.0),
		(16.0 / 255.0, 185.0 / 255.0, 129.0 / 255.0),
		(139.0 / 255.0, 92.0 / 255.0, 246.0 / 255.0),
		(244.0 / 255.0, 63.0 / 255.0, 94.0 / 255.0),
		(99.0 / 255.0, 102.0 / 255.0, 241.0 / 255.0),
		(20.0 / 255.0, 184.0 / 255.0, 166.0 / 255.0),
		(251.0 / 255.0, 146.0 / 255.0, 60.0 / 255.0),
		(132.0 / 255.0, 204.0 / 255.0, 22.0 / 255.0),
		(234.0 / 255.0, 179.0 / 255.0, 8.0 / 255.0),
		(217.0 / 255.0, 70.0 / 255.0, 239.0 / 255.0),
	]

	static func intensityLevel(durationSeconds: Int) -> Int {
		if durationSeconds <= 0 { return 0 }
		let minutes = durationSeconds / 60
		if minutes <= 15 { return 1 }
		if minutes <= 30 { return 2 }
		if minutes <= 45 { return 3 }
		return 4
	}

	static func composeSnapshot(
		from day: MobileActivityDay,
		sourceSummary: String = "iPhone"
	) -> DayWrappedSnapshot {
		let dayStart = Date(timeIntervalSince1970: TimeInterval(day.dayStartMs) / 1000)
		let formatter = DateFormatter()
		formatter.locale = .current
		formatter.dateFormat = "EEE, MMM d"

		var slots = (0 ..< slotsPerDay).map { index in
			WrappedSlot(
				id: index,
				startMs: day.dayStartMs + Int64(index * 10 * 60 * 1000),
				count: 0,
				category: .unknown,
				appName: nil,
				source: .none,
				macCount: 0,
				iphoneCount: 0
			)
		}

		for bucket in day.buckets where (0 ..< 24).contains(bucket.hour) {
			let level = intensityLevel(durationSeconds: bucket.durationSeconds)
			guard level > 0 else { continue }
			for slice in 0 ..< slicesPerHour {
				let index = bucket.hour * slicesPerHour + slice
				slots[index] = WrappedSlot(
					id: index,
					startMs: slots[index].startMs,
					count: max(slots[index].count, level),
					category: bucket.category,
					appName: bucket.appName,
					source: .iphone,
					macCount: 0,
					iphoneCount: max(slots[index].iphoneCount, level)
				)
			}
		}

		let subtitle = day.deviceName ?? sourceSummary
		return DayWrappedSnapshot(
			dayStartMs: day.dayStartMs,
			title: "DAY WRAPPED",
			subtitle: formatter.string(from: dayStart),
			updatedAtMs: day.syncedAt,
			sourceSummary: subtitle,
			pairedDeviceName: day.deviceName,
			mode: .categories,
			slots: slots
		)
	}

	static func sampleSnapshot(dayStartMs: Int64? = nil) -> DayWrappedSnapshot {
		let resolvedDayStartMs =
			dayStartMs
			?? Int64(Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000)
		let activeSlots: [Int: WrappedSlot] = [
			8 * 6 + 1: WrappedSlot(
				id: 49,
				startMs: resolvedDayStartMs + Int64(49 * 10 * 60 * 1000),
				count: 2,
				category: .study,
				appName: "Docs",
				source: .mac,
				macCount: 2,
				iphoneCount: 0
			),
			8 * 6 + 2: WrappedSlot(
				id: 50,
				startMs: resolvedDayStartMs + Int64(50 * 10 * 60 * 1000),
				count: 2,
				category: .study,
				appName: "Docs",
				source: .mac,
				macCount: 2,
				iphoneCount: 0
			),
			13 * 6 + 0: WrappedSlot(
				id: 78,
				startMs: resolvedDayStartMs + Int64(78 * 10 * 60 * 1000),
				count: 4,
				category: .work,
				appName: "VS Code",
				source: .both,
				macCount: 3,
				iphoneCount: 4
			),
			13 * 6 + 1: WrappedSlot(
				id: 79,
				startMs: resolvedDayStartMs + Int64(79 * 10 * 60 * 1000),
				count: 4,
				category: .work,
				appName: "VS Code",
				source: .both,
				macCount: 3,
				iphoneCount: 4
			),
			19 * 6 + 0: WrappedSlot(
				id: 114,
				startMs: resolvedDayStartMs + Int64(114 * 10 * 60 * 1000),
				count: 3,
				category: .leisure,
				appName: "YouTube",
				source: .iphone,
				macCount: 0,
				iphoneCount: 3
			),
			19 * 6 + 1: WrappedSlot(
				id: 115,
				startMs: resolvedDayStartMs + Int64(115 * 10 * 60 * 1000),
				count: 3,
				category: .leisure,
				appName: "YouTube",
				source: .iphone,
				macCount: 0,
				iphoneCount: 3
			),
		]

		let slots = (0 ..< slotsPerDay).map { index in
			activeSlots[index]
				?? WrappedSlot(
					id: index,
					startMs: resolvedDayStartMs + Int64(index * 10 * 60 * 1000),
					count: 0,
					category: .unknown,
					appName: nil,
					source: .none,
					macCount: 0,
					iphoneCount: 0
				)
		}

		return DayWrappedSnapshot(
			dayStartMs: resolvedDayStartMs,
			title: "DAY WRAPPED",
			subtitle: Date(timeIntervalSince1970: TimeInterval(resolvedDayStartMs) / 1000)
				.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()),
			updatedAtMs: resolvedDayStartMs,
			sourceSummary: "Mac + iPhone",
			pairedDeviceName: "iPhone",
			mode: .categories,
			slots: slots
		)
	}

	static func legendCategories(for snapshot: DayWrappedSnapshot, limit: Int? = nil) -> [WrappedCategory] {
		var counts: [WrappedCategory: Int] = [:]
		for slot in snapshot.slots where slot.count > 0 {
			counts[slot.category, default: 0] += slot.count
		}

		let ordered = WrappedCategory.allCases
			.filter { (counts[$0] ?? 0) > 0 }
			.sorted { lhs, rhs in
				let lhsCount = counts[lhs] ?? 0
				let rhsCount = counts[rhs] ?? 0
				if lhsCount == rhsCount {
					return lhs.rawValue < rhs.rawValue
				}
				return lhsCount > rhsCount
			}

		if let limit {
			return Array(ordered.prefix(limit))
		}
		return ordered
	}

	static func appColor(for name: String) -> Color {
		var hash = 0
		for scalar in name.unicodeScalars {
			hash = abs((hash * 31 + Int(scalar.value)) & 0x7fffffff)
		}
		let index = hash % appColorPalette.count
		let rgb = appColorPalette[index]
		return Color(red: rgb.0, green: rgb.1, blue: rgb.2)
	}

	static func slotColor(slot: WrappedSlot, mode: WrappedMode) -> Color {
		let alpha = dotAlphaByLevel[min(max(slot.count, 0), 4)]
		let base: Color
		switch mode {
		case .categories:
			base = slot.category.color
		case .apps:
			base = slot.appName.map(appColor(for:)) ?? WrappedCategory.unknown.color
		}

		return base.opacity(alpha)
	}

	static func timeMarkers(for snapshot: DayWrappedSnapshot) -> [Int] {
		var hourCounts: [Int: Int] = [:]
		var firstHour: Int?
		var lastHour: Int?

		for (index, slot) in snapshot.slots.enumerated() where slot.count > 0 {
			let hour = index / slicesPerHour
			hourCounts[hour, default: 0] += slot.count
			if firstHour == nil {
				firstHour = hour
			}
			lastHour = hour
		}

		guard let firstHour, let lastHour else {
			return [6, 12, 18]
		}

		var peakHour = firstHour
		var peakCount = 0
		var clusterStartHour: Int?
		var maxClusterDensity = 0

		for (hour, count) in hourCounts {
			if count > peakCount {
				peakCount = count
				peakHour = hour
			}
			let previousCount = hourCounts[hour - 1] ?? 0
			let density = count - previousCount
			if density > maxClusterDensity, hour != firstHour {
				maxClusterDensity = density
				clusterStartHour = hour
			}
		}

		var markers: [Int] = []
		let minimumSpacing = 2
		let canAdd: (Int) -> Bool = { hour in
			guard (0 ..< 24).contains(hour) else { return false }
			return !markers.contains(where: { abs($0 - hour) < minimumSpacing })
		}
		let addMarker: (Int) -> Void = { hour in
			if canAdd(hour) {
				markers.append(hour)
			}
		}

		addMarker(firstHour)
		addMarker(lastHour)
		if peakHour != firstHour, peakHour != lastHour {
			addMarker(peakHour)
		}
		if let clusterStartHour, clusterStartHour != firstHour, clusterStartHour != lastHour {
			addMarker(clusterStartHour)
		}

		let range = lastHour - firstHour
		if range > 6 {
			let intervals = min(4, range / 3)
			if intervals > 1 {
				for step in 1 ..< intervals {
					let hour = Int(round(Double(firstHour) + (Double(range) * Double(step) / Double(intervals))))
					addMarker(hour)
				}
			}
		}

		return markers.sorted()
	}

	static func hourString(for hour: Int) -> String {
		String(format: "%02d", hour)
	}

	static func isEmpty(snapshot: DayWrappedSnapshot?) -> Bool {
		guard let snapshot else { return true }
		return !snapshot.slots.contains(where: { $0.count > 0 })
	}
}
