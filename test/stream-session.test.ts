import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test"
import * as Effect from "effect/Effect"

import { StreamSession } from "@/domain/stream-session"

import { asText } from "./support"

const makeWriter = (isTTY = false) => {
  const chunks: Array<string> = []

  return {
    isTTY,
    chunks,
    write: (chunk: string | Uint8Array) => {
      chunks.push(asText(chunk))
    },
  }
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  mock.restore()
})

describe("domain/stream-session", () => {
  it("summarizes batch output and clears progress", async () => {
    const stdout = makeWriter()
    const progress = makeWriter()
    const phases: Array<string> = []
    let stopped = 0
    const summarizer = {
      summarizeBatch: mock(() => Effect.succeed("short")),
      summarizeWatch: mock(() => Effect.succeed("watch")),
    }
    const session = new StreamSession({
      summarizer,
      stdout,
      progress,
      isTTY: false,
      onProgressPhase: (phase) => void phases.push(phase),
      onProgressStop: () => {
        stopped += 1
      },
      idleMs: 10,
      interactiveGapMs: 5,
      progressFrameMs: 1,
    })

    session.push(Buffer.from("hello"))
    vi.advanceTimersByTime(2)
    await Effect.runPromise(session.end())

    expect(summarizer.summarizeBatch).toHaveBeenCalledWith("hello")
    expect(stdout.chunks.join("")).toBe("short\n")
    expect(phases).toEqual(["collecting", "summarizing"])
    expect(stopped).toBe(1)
    expect(progress.chunks.at(-1)).toBe("\r\u001b[2K")
  })

  it("stays silent for empty input and falls back on bad batch summaries", async () => {
    const emptyStdout = makeWriter()
    const emptySession = new StreamSession({
      summarizer: {
        summarizeBatch: mock(() => Effect.succeed("unused")),
        summarizeWatch: mock(() => Effect.succeed("unused")),
      },
      stdout: emptyStdout,
      isTTY: false,
      progressFrameMs: 0,
    })

    await Effect.runPromise(emptySession.end())
    expect(emptyStdout.chunks).toEqual([])

    const rawStdout = makeWriter()
    const rawSession = new StreamSession({
      summarizer: {
        summarizeBatch: mock((input: string) => Effect.succeed(input)),
        summarizeWatch: mock(() => Effect.succeed("unused")),
      },
      stdout: rawStdout,
      isTTY: false,
      progressFrameMs: 0,
    })

    rawSession.push(Buffer.from("raw input"))
    await Effect.runPromise(rawSession.end())

    expect(rawStdout.chunks.join("")).toBe("raw input")
  })

  it("switches to interactive passthrough when a prompt tail appears", async () => {
    const stdout = makeWriter()
    const session = new StreamSession({
      summarizer: {
        summarizeBatch: mock(() => Effect.fail(new Error("should not summarize"))),
        summarizeWatch: mock(() => Effect.succeed("unused")),
      },
      stdout,
      isTTY: false,
      idleMs: 10,
      interactiveGapMs: 5,
      progressFrameMs: 0,
    })

    session.push(Buffer.from("Continue?"))
    vi.advanceTimersByTime(6)
    session.push(Buffer.from(" yes"))
    await Effect.runPromise(session.end())

    expect(stdout.chunks.join("")).toBe("Continue? yes")
  })

  it("renders non-tty watch summaries and inserts separators between cycles", async () => {
    const stdout = makeWriter()
    const summarizer = {
      summarizeBatch: mock(() => Effect.succeed("unused")),
      summarizeWatch: mock((_previous: string, current: string) =>
        Effect.succeed(current.includes("third cycle") ? "second summary" : "first summary")
      ),
    }
    const session = new StreamSession({
      summarizer,
      stdout,
      isTTY: false,
      idleMs: 5,
      interactiveGapMs: 50,
      progressFrameMs: 0,
    })

    session.push(Buffer.from("first cycle"))
    vi.advanceTimersByTime(5)
    session.push(Buffer.from("\u001b[2Jsecond cycle"))
    vi.advanceTimersByTime(5)
    await flush()
    session.push(Buffer.from("\u001b[2Jthird cycle"))
    vi.advanceTimersByTime(5)
    await flush()
    await Effect.runPromise(session.end())

    expect(summarizer.summarizeWatch).toHaveBeenCalledTimes(2)
    expect(stdout.chunks.join("")).toBe("first summary\n\nsecond summary\n")
  })

  it("renders tty watch summaries with a full-screen refresh", async () => {
    const stdout = makeWriter(true)
    const session = new StreamSession({
      summarizer: {
        summarizeBatch: mock(() => Effect.succeed("unused")),
        summarizeWatch: mock(() => Effect.succeed("tty summary")),
      },
      stdout,
      isTTY: true,
      idleMs: 5,
      interactiveGapMs: 50,
      progressFrameMs: 0,
    })

    session.push(Buffer.from("before"))
    vi.advanceTimersByTime(5)
    session.push(Buffer.from("\u001b[2Jafter"))
    vi.advanceTimersByTime(5)
    await flush()
    await Effect.runPromise(session.end())

    expect(stdout.chunks.join("")).toBe("\u001b[2J\u001b[Htty summary\n")
  })

  it("falls back to raw watch output for bad summaries and thrown summaries", async () => {
    const rawStdout = makeWriter()
    const rawSession = new StreamSession({
      summarizer: {
        summarizeBatch: mock(() => Effect.succeed("unused")),
        summarizeWatch: mock((_previous: string, current: string) => Effect.succeed(current)),
      },
      stdout: rawStdout,
      isTTY: false,
      idleMs: 5,
      interactiveGapMs: 50,
      progressFrameMs: 0,
    })

    rawSession.push(Buffer.from("before"))
    vi.advanceTimersByTime(5)
    rawSession.push(Buffer.from("\u001b[2Jcurrent"))
    vi.advanceTimersByTime(5)
    await flush()
    rawSession.push(Buffer.from(" tail"))
    await Effect.runPromise(rawSession.end())

    expect(rawStdout.chunks.join("")).toBe("\u001b[2Jcurrent tail")

    const thrownStdout = makeWriter()
    const thrownSession = new StreamSession({
      summarizer: {
        summarizeBatch: mock(() => Effect.succeed("unused")),
        summarizeWatch: mock(() => Effect.fail(new Error("boom"))),
      },
      stdout: thrownStdout,
      isTTY: false,
      idleMs: 5,
      interactiveGapMs: 50,
      progressFrameMs: 0,
    })

    thrownSession.push(Buffer.from("before"))
    vi.advanceTimersByTime(5)
    thrownSession.push(Buffer.from("\u001b[2Jcurrent"))
    vi.advanceTimersByTime(5)
    await flush()
    await Effect.runPromise(thrownSession.end())

    expect(thrownStdout.chunks.join("")).toBe("\u001b[2Jcurrent")
  })
})
