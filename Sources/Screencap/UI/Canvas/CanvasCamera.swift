import CoreGraphics
import Foundation

/// Where the canvas is looked at from: a point of the canvas at `c` is drawn at `c * zoom + (x, y)`.
struct CanvasCamera: Equatable {
  var x: CGFloat = 0
  var y: CGFloat = 0
  var zoom: CGFloat = 0.3

  static let zooms: ClosedRange<CGFloat> = 0.06...2

  func clamped() -> CanvasCamera {
    var copy = self
    copy.zoom = min(max(zoom, Self.zooms.lowerBound), Self.zooms.upperBound)
    return copy
  }

  func toView(_ point: CGPoint) -> CGPoint { CGPoint(x: point.x * zoom + x, y: point.y * zoom + y) }
  func toCanvas(_ point: CGPoint) -> CGPoint { CGPoint(x: (point.x - x) / zoom, y: (point.y - y) / zoom) }
  func toView(_ rect: CGRect) -> CGRect {
    CGRect(origin: toView(rect.origin), size: CGSize(width: rect.width * zoom, height: rect.height * zoom))
  }
  func toCanvas(_ rect: CGRect) -> CGRect {
    CGRect(origin: toCanvas(rect.origin), size: CGSize(width: rect.width / zoom, height: rect.height / zoom))
  }

  /// Zoomed by `factor` with the canvas point under `point` held still.
  func zoomed(by factor: CGFloat, at point: CGPoint) -> CanvasCamera {
    let next = min(max(zoom * factor, Self.zooms.lowerBound), Self.zooms.upperBound)
    return CanvasCamera(x: point.x - (point.x - x) * next / zoom, y: point.y - (point.y - y) * next / zoom, zoom: next)
  }
}

/// Moves a camera to a target: a critically damped spring (no bounce) for a glide, an exponential slowing for a throw.
/// Zoom moves in log space, so zooming in and out feel alike.
struct CanvasMotion {
  private(set) var target: CanvasCamera
  private var velocity = (x: CGFloat(0), y: CGFloat(0), zoom: CGFloat(0))
  /// Seconds a throw takes to lose about two thirds of its distance; nil for a glide.
  private let coast: CGFloat?
  /// Settles in about 0.3 s.
  private static let stiffness: CGFloat = 2 * .pi / 0.3

  init(to target: CanvasCamera, coast: CGFloat? = nil) {
    self.target = target.clamped()
    self.coast = coast
  }

  /// The camera `seconds` later, and whether it has arrived.
  mutating func advance(_ camera: CanvasCamera, by seconds: CGFloat) -> (camera: CanvasCamera, arrived: Bool) {
    var (x, y, zoom) = (camera.x, camera.y, log(camera.zoom))
    let end = log(target.zoom)
    var left = min(seconds, 0.05)
    while left > 1e-6 {
      let step = min(1 / 240, left)
      left -= step
      if let coast {
        let keep = exp(-step / coast)
        x = target.x + (x - target.x) * keep
        y = target.y + (y - target.y) * keep
        zoom = end + (zoom - end) * keep
      } else {
        let k = Self.stiffness
        velocity.x += (-k * k * (x - target.x) - 2 * k * velocity.x) * step
        velocity.y += (-k * k * (y - target.y) - 2 * k * velocity.y) * step
        velocity.zoom += (-k * k * (zoom - end) - 2 * k * velocity.zoom) * step
        x += velocity.x * step
        y += velocity.y * step
        zoom += velocity.zoom * step
      }
    }
    let arrived = abs(x - target.x) < 0.3 && abs(y - target.y) < 0.3 && abs(zoom - end) < 0.0008 && abs(velocity.x) < 30 && abs(velocity.y) < 30
    return arrived ? (target, true) : (CanvasCamera(x: x, y: y, zoom: exp(zoom)), false)
  }
}
