import Foundation
import ScreencapCore

/// Prints a day as the canvas groups it: its threads and the things each was about.
enum CanvasCommand {
  static func run(location: StoreLocation, day: String?) throws {
    let database = try location.openDatabase()
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    let date = day.flatMap(formatter.date) ?? Date()
    let start = Calendar.current.startOfDay(for: date)
    let end = Calendar.current.date(byAdding: .day, value: 1, to: start)!
    let began = Date()
    let grouper = try CanvasLoader.grouper(database: database, location: location, now: Date().timeIntervalSince1970)
    let learned = Date()
    let canvas = try CanvasLoader.day(database: database, grouper: grouper, from: start, to: end)
    let grouped = Date()
    let activities = try database.activities(from: start.timeIntervalSince1970, to: end.timeIntervalSince1970).count
    for thread in canvas.threads {
      print("\(thread.name)  \(durationText(thread.seconds / 60))")
      for thing in thread.things {
        let visits = "\(thing.visits.count) visit\(thing.visits.count == 1 ? "" : "s")"
        print("    \(durationText(thing.seconds / 60))  \(thing.title)\(thing.place.isEmpty ? "" : "  (\(thing.place))")  \(visits), \(thing.shots.count) screens")
      }
    }
    let things = canvas.threads.reduce(0) { $0 + $1.things.count }
    print("\(canvas.threads.count) threads, \(things) things from \(activities) activities")
    print("learned names in \(Int(learned.timeIntervalSince(began) * 1000)) ms, grouped in \(Int(grouped.timeIntervalSince(learned) * 1000)) ms")
  }
}
