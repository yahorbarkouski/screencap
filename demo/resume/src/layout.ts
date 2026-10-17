// Every size in the demo, in one place.
//
// The GIF is shown about 880 pixels wide in a GitHub README, so every size here is chosen for what it becomes at
// that width: the canvas is 1280 wide, so multiply by 0.69. A 50-pixel caption reads at about 35 pixels; the
// screen's own 13-point text at about 10, and at 16 or more wherever the camera moves in.

/** The whole frame: the screen on the README's backdrop, and the captions under it. */
export const canvas = { width: 1280, height: 886 };
export const gutter = 40;

/** The screen as it sits in the frame. */
export const viewport = { x: gutter, y: gutter, width: canvas.width - 2 * gutter, height: 750, radius: 18 };

/** Under the screen: one short line saying what is happening. */
export const captionArea = { y: viewport.y + viewport.height + 12, height: canvas.height - (viewport.y + viewport.height + 12) };

/**
 * The Mac being shown, in points: a small screen, so its windows are few and its text is large. The palette keeps
 * its real size, 880 by 512 points, and the windows are laid out so that each thread's three places are plain to see.
 */
export const screen = { width: 1024, height: 640, menuBar: 24 };
export const scale = viewport.width / screen.width;

export type Rect = { x: number; y: number; width: number; height: number };
