import AppKit
import SwiftUI

/// What a resume could not do, said once and then gone.
///
/// The palette closes the moment a thread is chosen, which is the point: the windows behind it are what you asked
/// for, and when they all came there is nothing to add. When something could not be reached, the line naming it,
/// with the thread and where you left off, is shown over them for a few seconds instead of inside a window that is
/// no longer there.
@MainActor
final class ResumeToast {
  private var panel: NSPanel?
  private var hideWork: DispatchWorkItem?

  func show(thread: String, leftOff: String, trouble: String?, seconds: Double = 4) {
    hideWork?.cancel()
    let view = ResumeToastView(thread: thread, leftOff: leftOff, trouble: trouble)
    let hosting = NSHostingView(rootView: view)
    let size = view.fittedSize
    let panel = self.panel ?? make()
    self.panel = panel
    // The same glass the palette is made of, clipped to its rounded shape.
    hosting.frame = NSRect(origin: .zero, size: size)
    hosting.autoresizingMask = [.width, .height]
    let glass = NSGlassEffectView.rounded(14, content: hosting)
    glass.frame = hosting.frame
    panel.contentView = glass
    let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
    let frame = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1_440, height: 900)
    panel.setFrame(
      NSRect(x: frame.midX - size.width / 2, y: frame.maxY - size.height - 28, width: size.width, height: size.height),
      display: true)
    panel.alphaValue = 0
    panel.orderFrontRegardless()
    panel.invalidateShadow()
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.14
      panel.animator().alphaValue = 1
    }
    let work = DispatchWorkItem { [weak self] in self?.hide() }
    hideWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
  }

  func hide() {
    guard let panel else { return }
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.2
      panel.animator().alphaValue = 0
    } completionHandler: { MainActor.assumeIsolated { panel.orderOut(nil) } }
  }

  /// Never takes the keys: whatever the resume brought forward keeps them.
  private func make() -> NSPanel {
    let panel = NSPanel(
      contentRect: .zero, styleMask: [.nonactivatingPanel, .borderless], backing: .buffered, defer: false)
    panel.isFloatingPanel = true
    panel.level = .statusBar
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = true
    panel.ignoresMouseEvents = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    return panel
  }
}

struct ResumeToastView: View {
  let thread: String
  let leftOff: String
  let trouble: String?

  /// The size that shows every line whole. `fittingSize` rounds the text's width down to a whole point, and a line
  /// given a fraction of a point less than it needs is cut short with an ellipsis, so one point is added back.
  var fittedSize: CGSize {
    let fitted = NSHostingView(rootView: self).fittingSize
    return CGSize(width: fitted.width + 1, height: fitted.height)
  }

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "arrow.uturn.backward").font(.ui(12)).foregroundStyle(Theme.ink4)
      VStack(alignment: .leading, spacing: 1) {
        Text(thread).font(.ui(13, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
        if !leftOff.isEmpty {
          Text(leftOff).font(.ui(11.5)).foregroundStyle(Theme.ink4).lineLimit(1)
        }
        if let trouble, !trouble.isEmpty {
          Text(trouble).font(.ui(11)).foregroundStyle(Theme.ink5).lineLimit(1)
        }
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 11)
    .frame(maxWidth: 460, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
  }
}
