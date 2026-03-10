import * as Effect from "effect/Effect"
import {
  DEFAULT_IDLE_MS,
  DEFAULT_INTERACTIVE_GAP_MS,
  DEFAULT_PROGRESS_FRAME_MS,
} from "@/domain/config"
import {
  ensureTrailingNewline,
  hasPromptLikeTail,
  hasRedrawSignal,
  looksLikeBadDistillation,
  normalizeForModel,
  structuralSimilarity,
} from "@/domain/text"

type Mode = "undecided" | "watch" | "interactive"

export type ProgressPhase = "collecting" | "summarizing"

interface Burst {
  id: number
  raw: string
  normalized: string
}

const PROGRESS_FRAMES = ["-", "\\", "|", "/"]
const PROGRESS_DOT_FRAMES = ["", ".", "..", "...", "..", "."]
const PROGRESS_LABELS: Record<ProgressPhase, string> = {
  collecting: "qq: waiting",
  summarizing: "qq: summarizing",
}

export interface WriterLike {
  write(chunk: string | Uint8Array): unknown
}

export interface SessionSummarizer<E = unknown, R = never> {
  summarizeBatch(input: string): Effect.Effect<string, E, R>
  summarizeWatch(previousCycle: string, currentCycle: string): Effect.Effect<string, E, R>
}

export interface StreamSessionOptions<E = unknown, R = never> {
  summarizer: SessionSummarizer<E, R>
  stdout: WriterLike
  isTTY: boolean
  progress?: WriterLike
  onProgressPhase?: (phase: ProgressPhase) => void
  onProgressStop?: () => void
  idleMs?: number
  interactiveGapMs?: number
  progressFrameMs?: number
}

export class StreamSession<E = unknown, R = never> {
  private readonly summarizer
  private readonly stdout
  private readonly isTTY
  private readonly progress
  private readonly onProgressPhase
  private readonly onProgressStop
  private readonly idleMs
  private readonly interactiveGapMs
  private readonly progressFrameMs
  private readonly rawBuffers: Array<Buffer> = []
  private readonly completedBursts: Array<Burst> = []
  private readonly renderedPairs = new Set<string>()
  private currentBurstBuffers: Array<Buffer> = []
  private mode: Mode = "undecided"
  private progressPhase: ProgressPhase = "collecting"
  private sawRedraw = false
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private interactiveTimer: ReturnType<typeof setTimeout> | null = null
  private progressTimer: ReturnType<typeof setInterval> | null = null
  private queue: Effect.Effect<void, never, R> = Effect.void
  private nextBurstId = 1
  private emittedWatchOutput = false
  private passthrough = false
  private progressVisible = false
  private progressFrameIndex = 0
  private lastProgressRenderAt = 0

  constructor(options: StreamSessionOptions<E, R>) {
    this.summarizer = options.summarizer
    this.stdout = options.stdout
    this.isTTY = options.isTTY
    this.progress = options.progress ?? null
    this.onProgressPhase = options.onProgressPhase ?? null
    this.onProgressStop = options.onProgressStop ?? null
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS
    this.interactiveGapMs = options.interactiveGapMs ?? DEFAULT_INTERACTIVE_GAP_MS
    this.progressFrameMs = options.progressFrameMs ?? DEFAULT_PROGRESS_FRAME_MS
    this.onProgressPhase?.(this.progressPhase)
    this.startProgress()
  }

  push(chunk: Buffer) {
    if (chunk.length === 0) {
      return
    }

    if (this.passthrough) {
      this.stdout.write(chunk)
      return
    }

    if (this.mode !== "watch") {
      this.rawBuffers.push(chunk)
    }

    this.currentBurstBuffers.push(chunk)
    this.sawRedraw ||= hasRedrawSignal(chunk.toString("utf8"))

    this.restartIdleTimer()
    this.restartInteractiveTimer()
    this.renderProgressIfDue()
  }

  end() {
    this.clearTimers()

    if (this.passthrough) {
      this.stopProgress(true)
      return Effect.void
    }

    this.closeCurrentBurst()

    if (this.mode === "watch") {
      this.scheduleLatestWatchRender()
      return this.queue
    }

    const rawInput = Buffer.concat(this.rawBuffers).toString("utf8")

    if (!rawInput) {
      this.stopProgress(true)
      return Effect.void
    }

    this.setProgressPhase("summarizing")

    return this.summarizer.summarizeBatch(normalizeForModel(rawInput)).pipe(
      Effect.flatMap((summary) =>
        Effect.sync(() => {
          if (looksLikeBadDistillation(rawInput, summary)) {
            this.stopProgress(true)
            this.stdout.write(Buffer.concat(this.rawBuffers))
            return
          }

          this.stopProgress(true)
          this.stdout.write(ensureTrailingNewline(summary.trim()))
        })
      ),
      Effect.catch((cause) =>
        Effect.sync(() => {
          this.stopProgress(true)
          this.stdout.write(Buffer.concat(this.rawBuffers))
        }).pipe(Effect.flatMap(() => Effect.fail(cause)))
      )
    )
  }

  dispose() {
    this.clearTimers()
    this.stopProgress(true)
  }

  private restartIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
    }

    this.idleTimer = setTimeout(() => {
      this.closeCurrentBurst()

      if (this.mode === "undecided" && this.shouldPromoteToWatch()) {
        this.promoteToWatch()
        this.scheduleLatestWatchRender()
      }
    }, this.idleMs)
  }

  private restartInteractiveTimer() {
    if (this.mode !== "undecided") {
      return
    }

    if (this.interactiveTimer) {
      clearTimeout(this.interactiveTimer)
    }

    if (!hasPromptLikeTail(this.getTail())) {
      return
    }

    this.interactiveTimer = setTimeout(() => {
      if (this.mode !== "undecided" || !hasPromptLikeTail(this.getTail())) {
        return
      }

      this.mode = "interactive"
      this.passthrough = true
      this.clearTimers()
      this.stopProgress(true)
      this.stdout.write(Buffer.concat(this.rawBuffers))
    }, this.interactiveGapMs)
  }

  private clearTimers() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }

    if (this.interactiveTimer) {
      clearTimeout(this.interactiveTimer)
      this.interactiveTimer = null
    }
  }

  private startProgress() {
    if (!this.progress || this.progressFrameMs <= 0 || this.progressTimer) {
      return
    }

    this.renderProgress()
    this.progressTimer = setInterval(() => {
      if (this.progressTimer === null || this.mode === "watch" || this.passthrough) {
        return
      }

      this.renderProgress()
    }, this.progressFrameMs)
  }

  private setProgressPhase(phase: ProgressPhase) {
    if (this.progressPhase === phase) {
      return
    }

    this.progressPhase = phase
    this.progressFrameIndex = 0
    this.onProgressPhase?.(phase)
    this.renderProgress()
  }

  private renderProgressIfDue() {
    if (!this.progress || this.mode === "watch" || this.passthrough) {
      return
    }

    if (Date.now() - this.lastProgressRenderAt < this.progressFrameMs) {
      return
    }

    this.renderProgress()
  }

  private renderProgress() {
    if (!this.progress) {
      return
    }

    const frame = PROGRESS_FRAMES[this.progressFrameIndex % PROGRESS_FRAMES.length] ?? "-"
    const dots =
      PROGRESS_DOT_FRAMES[
        Math.floor(this.progressFrameIndex / PROGRESS_FRAMES.length) % PROGRESS_DOT_FRAMES.length
      ] ?? ""

    this.progressFrameIndex += 1
    this.lastProgressRenderAt = Date.now()
    this.progress.write(`\r\u001b[2K${frame} ${PROGRESS_LABELS[this.progressPhase]}${dots}`)
    this.progressVisible = true
  }

  private stopProgress(clearLine = false) {
    if (this.progressTimer) {
      clearInterval(this.progressTimer)
      this.progressTimer = null
    }

    this.onProgressStop?.()

    if (!clearLine || !this.progressVisible || !this.progress) {
      return
    }

    this.progress.write("\r\u001b[2K")
    this.progressVisible = false
  }

  private closeCurrentBurst() {
    if (this.currentBurstBuffers.length === 0 || this.passthrough) {
      return
    }

    const raw = Buffer.concat(this.currentBurstBuffers).toString("utf8")
    this.currentBurstBuffers = []

    if (!raw) {
      return
    }

    this.completedBursts.push({
      id: this.nextBurstId,
      raw,
      normalized: normalizeForModel(raw),
    })
    this.nextBurstId += 1
  }

  private latestPair() {
    const previous = this.completedBursts[this.completedBursts.length - 2]
    const current = this.completedBursts[this.completedBursts.length - 1]

    if (previous === undefined || current === undefined) {
      return
    }

    return { previous, current }
  }

  private shouldPromoteToWatch() {
    const pair = this.latestPair()

    if (pair === undefined) {
      return false
    }

    const similarity = structuralSimilarity(pair.previous.raw, pair.current.raw)

    return this.sawRedraw || similarity >= 0.55
  }

  private promoteToWatch() {
    if (this.mode === "watch") {
      return
    }

    this.mode = "watch"
    this.rawBuffers.length = 0
    this.clearTimers()
    this.stopProgress(true)
  }

  private scheduleLatestWatchRender() {
    const pair = this.latestPair()

    if (pair === undefined) {
      return
    }

    const key = `${String(pair.previous.id)}:${String(pair.current.id)}`

    if (this.renderedPairs.has(key)) {
      return
    }

    this.renderedPairs.add(key)
    this.queue = this.queue.pipe(
      Effect.andThen(
        this.summarizer.summarizeWatch(pair.previous.normalized, pair.current.normalized).pipe(
          Effect.flatMap((summary) =>
            Effect.sync(() => {
              if (looksLikeBadDistillation(pair.current.raw, summary)) {
                this.renderWatchFallback(pair.current.raw)
                return
              }

              this.renderWatchSummary(summary.trim())
              this.trimWatchHistory()
            })
          ),
          Effect.catch(() =>
            Effect.sync(() => {
              this.renderWatchFallback(pair.current.raw)
            })
          )
        )
      )
    )
  }

  private renderWatchSummary(summary: string) {
    const output = ensureTrailingNewline(summary)

    if (this.isTTY) {
      this.stdout.write(`\u001b[2J\u001b[H${output}`)
      this.emittedWatchOutput = true
      return
    }

    if (this.emittedWatchOutput) {
      this.stdout.write("\n")
    }

    this.stdout.write(output)
    this.emittedWatchOutput = true
  }

  private renderWatchFallback(raw: string) {
    this.mode = "interactive"
    this.passthrough = true
    this.stopProgress(true)
    this.stdout.write(raw)
  }

  private getTail() {
    const tailBuffers: Array<Buffer> = []
    let remaining = 256

    for (let index = this.rawBuffers.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const chunk = this.rawBuffers[index]

      if (chunk === undefined) {
        continue
      }

      if (chunk.length <= remaining) {
        tailBuffers.unshift(chunk)
        remaining -= chunk.length
      } else {
        tailBuffers.unshift(chunk.subarray(chunk.length - remaining))
        remaining = 0
      }
    }

    return Buffer.concat(tailBuffers).toString("utf8")
  }

  private trimWatchHistory() {
    if (this.mode !== "watch" || this.completedBursts.length <= 2) {
      return
    }

    this.completedBursts.splice(0, this.completedBursts.length - 2)
  }
}
