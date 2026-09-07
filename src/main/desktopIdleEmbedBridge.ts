import { screen } from 'electron'
import koffi from 'koffi'

type Point = { x: number; y: number }

type BridgeOptions = {
  /** True while desktop mode is unlocked (not WorkerW-embedded). */
  isArmed: () => boolean
  onEmbed: () => void
}

const POLL_MS = 50
const IDLE_EMBED_MS = 10_000

const VK_LBUTTON = 0x01
const VK_RBUTTON = 0x02
const VK_MBUTTON = 0x04

/**
 * After cold-start desktop unlock: 10s with no mouse/keyboard input → embed.
 */
export class DesktopIdleEmbedBridge {
  private timer: ReturnType<typeof setInterval> | null = null
  private idleMs = 0
  private lastPt: Point | null = null
  private GetAsyncKeyState: ((vKey: number) => number) | null = null
  private readonly options: BridgeOptions

  constructor(options: BridgeOptions) {
    this.options = options
  }

  private bindUser32(): boolean {
    if (this.GetAsyncKeyState) return true
    if (process.platform !== 'win32') return false
    try {
      const user32 = koffi.load('user32.dll')
      this.GetAsyncKeyState = user32.func('GetAsyncKeyState', 'int16', ['int']) as (
        vKey: number
      ) => number
      return true
    } catch (error) {
      console.warn('[idle-embed] user32 load skipped', error)
      return false
    }
  }

  /** Call from renderer keyboard activity (before-input-event). */
  noteActivity(): void {
    this.idleMs = 0
  }

  start(): void {
    if (process.platform !== 'win32' || this.timer) return
    if (!this.bindUser32()) return

    this.timer = setInterval(() => {
      try {
        if (!this.options.isArmed() || !this.GetAsyncKeyState) {
          this.idleMs = 0
          this.lastPt = null
          return
        }

        const pt = screen.getCursorScreenPoint()
        const buttonsDown =
          (this.GetAsyncKeyState(VK_LBUTTON) & 0x8000) !== 0 ||
          (this.GetAsyncKeyState(VK_RBUTTON) & 0x8000) !== 0 ||
          (this.GetAsyncKeyState(VK_MBUTTON) & 0x8000) !== 0

        const moved =
          !this.lastPt || this.lastPt.x !== pt.x || this.lastPt.y !== pt.y
        this.lastPt = pt

        if (moved || buttonsDown) {
          this.idleMs = 0
          return
        }

        this.idleMs += POLL_MS
        if (this.idleMs >= IDLE_EMBED_MS) {
          this.idleMs = 0
          console.log('[idle-embed] 10s idle → under-icons')
          this.options.onEmbed()
        }
      } catch (error) {
        console.error('[idle-embed] poll error:', error)
      }
    }, POLL_MS)

    console.log('[idle-embed] 10s idle → embed armed (unlocked desktop only)')
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.idleMs = 0
    this.lastPt = null
  }
}
