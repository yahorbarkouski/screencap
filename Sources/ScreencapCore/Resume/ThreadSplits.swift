import Foundation

/// Working out whether a thread holds two pieces of work, over a store, so the palette and the command line find
/// exactly the same splits. `ThreadSplit` is the arithmetic; applying one is `Corrections.split`, because the new
/// thread needs a name, and only the engine can write one.
public enum ThreadSplits {
  /// The split a thread would be offered, or nil when it is one piece of work.
  ///
  /// `readers` is passed in rather than built here: building one reads the transcript cache, and the palette asks
  /// about a dozen threads at a time.
  public static func candidate(
    for threadID: Int64, in database: AppDatabase, readers: ThingReaders,
    thresholds: ThreadSplitThresholds = ThreadSplitThresholds()
  ) throws -> ThreadSplitCandidate? {
    let captures = try database.capturesForBindings(threadID: threadID)
    let read = ThreadSplit.activityTimes(captures: captures, readers: readers)
    return ThreadSplit.candidate(
      threadID: threadID, activityTimes: read.times, labels: read.labels, thresholds: thresholds)
  }
}
