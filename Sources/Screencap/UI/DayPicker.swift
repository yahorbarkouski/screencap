import ScreencapCore
import SwiftUI

/// A month to jump around in: each day's cell is shaded by its time on screen, today is ringed and the day shown is
/// filled. Days after today cannot be picked.
struct DayPicker: View {
  let model: AppModel
  var pick: (Date) -> Void
  @State private var month: Date
  @State private var minutes: [Date: Double] = [:]

  init(model: AppModel, pick: @escaping (Date) -> Void) {
    self.model = model
    self.pick = pick
    _month = State(initialValue: Calendar.current.dateInterval(of: .month, for: model.day)?.start ?? model.day)
  }

  var body: some View {
    let calendar = Calendar.current
    let peak = max(minutes.values.max() ?? 1, 60)
    VStack(spacing: 10) {
      HStack {
        Text(month.formatted(.dateTime.month(.wide).year())).font(.ui(13.5, .medium)).foregroundStyle(Theme.ink)
        Spacer()
        RoundIconButton(systemName: "chevron.left", size: 24) { shift(-1) }
        RoundIconButton(systemName: "chevron.right", size: 24) { shift(1) }
          .disabled(calendar.isDate(month, equalTo: Date(), toGranularity: .month))
      }
      LazyVGrid(columns: Array(repeating: GridItem(.fixed(34), spacing: 2), count: 7), spacing: 2) {
        ForEach(Array(weekdaySymbols.enumerated()), id: \.offset) { _, symbol in
          Text(symbol).font(.ui(11, .medium)).foregroundStyle(Theme.ink6).frame(height: 20)
        }
        ForEach(Array(cells.enumerated()), id: \.offset) { _, day in
          if let day {
            cell(day, minutes: minutes[day] ?? 0, peak: peak)
          } else {
            Color.clear.frame(width: 34, height: 34)
          }
        }
      }
      HStack {
        Button("Today") { pick(Date()) }.buttonStyle(PillStyle()).disabled(model.isToday)
        Spacer()
        if let total = monthMinutes { Text("\(durationText(total)) this month").font(.mono(11)).foregroundStyle(Theme.ink5) }
      }
    }
    .padding(14)
    .frame(width: 268)
    .onAppear(perform: load)
    .onChange(of: month) { load() }
  }

  func cell(_ day: Date, minutes: Double, peak: Double) -> some View {
    let calendar = Calendar.current
    let selected = calendar.isDate(day, inSameDayAs: model.day)
    let today = calendar.isDateInToday(day)
    let future = day > Date()
    return Text("\(calendar.component(.day, from: day))")
      .font(.mono(12, selected ? .semibold : .regular))
      .foregroundStyle(selected ? Theme.onInk : future ? Theme.ink6.opacity(0.5) : minutes > 0 ? Theme.ink : Theme.ink5)
      .frame(width: 34, height: 34)
      .background {
        if selected {
          Circle().fill(Theme.ink)
        } else if minutes > 0 {
          // Darker with more time on screen, never too faint to see.
          Circle().fill(Theme.ink.opacity(0.06 + 0.22 * min(1, minutes / peak)))
        }
      }
      .overlay { if today && !selected { Circle().strokeBorder(Theme.ink3, lineWidth: 1.2) } }
      .contentShape(Circle())
      .onTapGesture { if !future { pick(day) } }
      .help(minutes > 0 ? durationText(minutes) : "")
  }

  /// The month's days in weeks, with empty cells before the first.
  var cells: [Date?] {
    let calendar = Calendar.current
    guard let range = calendar.range(of: .day, in: .month, for: month) else { return [] }
    let lead = (calendar.component(.weekday, from: month) - calendar.firstWeekday + 7) % 7
    return Array(repeating: nil, count: lead) + range.compactMap { calendar.date(byAdding: .day, value: $0 - 1, to: month) }
  }

  var weekdaySymbols: [String] {
    let calendar = Calendar.current
    let symbols = calendar.veryShortStandaloneWeekdaySymbols
    return Array(symbols[(calendar.firstWeekday - 1)...] + symbols[..<(calendar.firstWeekday - 1)])
  }

  var monthMinutes: Double? {
    let total = minutes.values.reduce(0, +)
    return total > 0 ? total : nil
  }

  func shift(_ delta: Int) {
    month = Calendar.current.date(byAdding: .month, value: delta, to: month) ?? month
  }

  func load() {
    minutes = model.minutesPerDay(inMonthOf: month)
  }
}
