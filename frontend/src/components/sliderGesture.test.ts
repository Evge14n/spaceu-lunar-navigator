import { describe, expect, it } from 'vitest'
import { SliderTouchGuard } from './sliderGesture'

// Event sequences recorded from Chromium with Android touch emulation on the live site
// (390 x 844, slider of 8760 hours, finger at 64 % of the width).
// Pointer id is the third number (default 1); id 1 is the primary finger.
function run(events: Array<[string, ...number[]]>) {
  const commits: number[] = []
  const g = new SliderTouchGuard((v) => commits.push(v))
  for (const [kind, a, b, c = 1] of events) {
    if (kind === 'down-touch') g.pointerDown('touch', a, b, c, c === 1)
    else if (kind === 'down-mouse') g.pointerDown('mouse', a, b, c)
    else if (kind === 'input') g.input(a)
    else if (kind === 'move') g.pointerMove(a, b, c)
    else if (kind === 'up') g.pointerUp(a ?? 1)
    else if (kind === 'cancel') g.pointerCancel(a ?? 1)
  }
  return commits
}

describe('time slider touch guard', () => {
  it('a page scroll that starts on the slider does not move the time (the 4 JUL 2027 report)', () => {
    // pointerdown -> input (value jumped to the finger) -> pointermove up -> pointercancel
    const commits = run([
      ['down-touch', 250, 700],
      ['input', 5672],
      ['move', 250, 669],
      ['cancel'],
    ])
    expect(commits).toEqual([])
  })

  it('a slow vertical scroll with several inputs still commits nothing', () => {
    const commits = run([
      ['down-touch', 250, 700],
      ['input', 5672],
      ['move', 252, 690],
      ['input', 5690],
      ['move', 253, 660],
      ['up'],
    ])
    expect(commits).toEqual([])
  })

  it('a tap on the track does not jump the time (Chromium: pointerdown, input, pointerup)', () => {
    expect(run([['down-touch', 250, 700], ['input', 5672], ['up']])).toEqual([])
    // a tap on the thumb itself: no input at all
    expect(run([['down-touch', 250, 700], ['up']])).toEqual([])
  })

  it('a scroll that the browser cancels without any pointermove still commits nothing', () => {
    expect(run([['down-touch', 250, 700], ['input', 5672], ['cancel']])).toEqual([])
  })

  it("a second finger does not end or reset the first finger's scroll", () => {
    const commits = run([
      ['down-touch', 250, 700, 1],
      ['input', 5672],
      ['down-touch', 100, 500, 2],
      ['up', 2],
      ['move', 250, 650, 1],
      ['input', 5700],
      ['cancel', 1],
    ])
    expect(commits).toEqual([])
  })

  it('a sideways drag moves the time, including the value from before the drag was recognised', () => {
    const commits = run([
      ['down-touch', 117, 700],
      ['input', 2534],
      ['move', 110, 700],
      ['move', 100, 701],
      ['input', 2100],
      ['move', 57, 704],
      ['input', 770],
      ['up'],
    ])
    expect(commits).toEqual([2534, 2100, 770])
  })

  it('the next gesture starts clean after a cancelled one', () => {
    const commits = run([
      ['down-touch', 250, 700],
      ['input', 5672],
      ['cancel'],
      ['down-touch', 100, 700],
      ['move', 140, 702],
      ['input', 1500],
      ['up'],
    ])
    expect(commits).toEqual([1500])
  })

  it('a gesture whose pointerup never came is replaced by the next touch', () => {
    expect(run([['down-touch', 250, 700, 1], ['input', 5672], ['down-touch', 100, 700, 1], ['move', 140, 701, 1], ['input', 1500], ['up', 1]])).toEqual([1500])
  })

  it('mouse and keyboard change the time at once', () => {
    expect(run([['down-mouse', 10, 10], ['input', 42], ['up']])).toEqual([42])
    // keyboard: no pointer at all
    expect(run([['input', 43], ['input', 44]])).toEqual([43, 44])
  })
})
