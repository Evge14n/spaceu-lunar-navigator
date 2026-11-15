// Touch guard for the time slider.
//
// On a phone the slider spans the whole screen width, so a thumb that starts a vertical page scroll
// often lands on it. Chrome on Android then moves the value to the touch point before it hands the
// gesture over to scrolling: pointerdown -> input (jumped value) -> pointercancel -> change.
// The time silently jumped months away (reported 14.11: 4 JUL 2027 without touching the time).
//
// Rule: with a finger, a new value counts only once the finger has moved sideways (more than
// SIDEWAYS_PX and more than it moved up or down). Taps on the track and scrolls are ignored.
// Mouse, pen and keyboard work as before.

export const SIDEWAYS_PX = 6

export class SliderTouchGuard {
  private touch = false
  private id = -1
  private x0 = 0
  private y0 = 0
  private sideways = false
  private pending: number | null = null
  private commit: (value: number) => void = () => {}

  constructor(commit?: (value: number) => void) {
    if (commit) this.commit = commit
  }

  /** Where accepted values go (the latest React callback). */
  onCommit(commit: (value: number) => void): void {
    this.commit = commit
  }

  pointerDown(pointerType: string, x: number, y: number, id = 0, primary = true): void {
    if (!primary) return // a second finger: the first one's gesture goes on
    this.touch = pointerType === 'touch'
    this.id = id
    this.x0 = x
    this.y0 = y
    this.sideways = false
    this.pending = null
  }

  /** The input event: commits at once unless a finger gesture is still undecided or vertical. */
  input(value: number): void {
    if (!this.touch || this.sideways) {
      this.pending = null
      this.commit(value)
      return
    }
    this.pending = value
  }

  pointerMove(x: number, y: number, id = 0): void {
    if (!this.touch || this.sideways || id !== this.id) return
    const dx = Math.abs(x - this.x0)
    const dy = Math.abs(y - this.y0)
    if (dx > SIDEWAYS_PX && dx > dy) {
      this.sideways = true
      if (this.pending !== null) this.commit(this.pending)
      this.pending = null
    }
  }

  /**
   * pointerup: a value from a tap or an up-or-down move is dropped. Chromium sets the value on a tap
   * (pointerdown, input, pointerup), and a tap is also how people stop a page that is still scrolling.
   */
  pointerUp(id = 0): void {
    if (id !== this.id && this.touch) return
    this.end()
  }

  /** pointercancel: the browser took the gesture for scrolling; nothing from it counts. */
  pointerCancel(id = 0): void {
    if (id !== this.id && this.touch) return
    this.end()
  }

  private end(): void {
    this.touch = false
    this.id = -1
    this.sideways = false
    this.pending = null
  }
}
