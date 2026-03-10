import { afterEach, describe, expect, it, mock } from "bun:test"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { renderPrompt } from "@/domain/prompt"
import type { StreamSession } from "@/domain/stream-session"
import type { RuntimeLike } from "@/platform/runtime"
import { DistillError, ModelError, UsageError } from "@/schema/errors"
import {
  DistillEngine,
  progressOptions,
  readIntoSession,
  runSession,
  summarizerFor,
} from "@/services/distill-engine"
import { ModelGateway } from "@/services/model-gateway"

import { captureRuntime, makeWriter, TestInput } from "./support"

interface TestWriter extends ReturnType<typeof makeWriter> {}
interface TestRuntime extends RuntimeLike {
  stdin: TestInput
  stdout: TestWriter
  stderr: TestWriter
}

const makeRuntime = (overrides: Partial<TestRuntime> = {}): TestRuntime => {
  const stdin = new TestInput()
  const stdout = makeWriter()
  const stderr = makeWriter()

  return {
    env: {},
    stdin,
    stdout,
    stderr,
    ...overrides,
  }
}

const config = {
  question: "what changed?",
  provider: "ollama" as const,
  model: "qwen",
  host: "http://localhost:11434",
  apiKey: "",
  timeoutMs: 100,
  thinking: false,
}

const makeModelGateway = (generateText: typeof ModelGateway.Service.generateText) =>
  ({ generateText }) satisfies typeof ModelGateway.Service

afterEach(() => {
  mock.restore()
})

describe("services/distill-engine", () => {
  it("selects progress writers and emits stderr protocol markers", () => {
    const protocolRuntime = makeRuntime({
      env: { QQ_PROGRESS_PROTOCOL: "stderr" },
      stdout: makeWriter(true),
      stderr: makeWriter(true),
    })
    const protocol = progressOptions(protocolRuntime)

    expect(protocol.progress).toBeUndefined()
    protocol.onProgressPhase?.("summarizing")
    protocol.onProgressStop?.()
    expect(protocolRuntime.stderr.chunks.join("")).toBe(
      "__QQ_PROGRESS__:phase:summarizing\n__QQ_PROGRESS__:stop\n"
    )

    const fallbackRuntime = makeRuntime({
      stdout: makeWriter(true),
      stderr: makeWriter(false),
    })
    const fallback = progressOptions(fallbackRuntime)
    expect(fallback.progress).toBe(fallbackRuntime.stdout)

    const stderrTtyRuntime = makeRuntime({
      stdout: makeWriter(false),
      stderr: makeWriter(true),
    })
    const stderrTty = progressOptions(stderrTtyRuntime)
    expect(stderrTty.progress).toBe(stderrTtyRuntime.stderr)

    expect(progressOptions(makeRuntime()).progress).toBeUndefined()
  })

  it("reads session input as buffers and propagates read errors", async () => {
    const stdin = new TestInput()
    const pushed: Array<Buffer> = []
    const promise = Effect.runPromise(
      readIntoSession(stdin, {
        push: (chunk: Buffer) => {
          pushed.push(chunk)
        },
      } as unknown as StreamSession)
    )

    stdin.emit("data", "a")
    stdin.emit("data", Uint8Array.from(Buffer.from("b")))
    stdin.emit("end")
    await promise

    expect(stdin.resumed).toBe(true)
    expect(pushed.map((chunk) => chunk.toString("utf8"))).toEqual(["a", "b"])

    const failingInput = new TestInput()
    const failingPromise = Effect.runPromise(
      readIntoSession(failingInput, {
        push: () => undefined,
      } as unknown as StreamSession)
    )
    failingInput.emit("error", new Error("broken pipe"))
    await expect(failingPromise).rejects.toThrow("broken pipe")
  })

  it("builds prompt-aware summarizer functions", async () => {
    const gateway = makeModelGateway(({ prompt }) => Effect.succeed(renderPrompt(prompt)))
    const summarizer = summarizerFor(gateway, config)

    await expect(
      Effect.runPromise(summarizer.summarizeBatch("diff").pipe(Effect.provide(BunHttpClient.layer)))
    ).resolves.toContain("Command output:\ndiff")
    await expect(
      Effect.runPromise(
        summarizer.summarizeWatch("before", "after").pipe(Effect.provide(BunHttpClient.layer))
      )
    ).resolves.toContain("Previous cycle:\nbefore")
  })

  it("runs a full batch session and rejects tty stdin", async () => {
    const runtime = makeRuntime()
    const sessionPromise = Effect.runPromise(
      runSession({
        runtime,
        modelGateway: makeModelGateway(() => Effect.succeed("summary")),
        config,
      }).pipe(Effect.provide(BunHttpClient.layer))
    )

    runtime.stdin.emit("data", Buffer.from("hello"))
    runtime.stdin.emit("end")
    await sessionPromise

    expect(runtime.stdout.chunks.join("")).toBe("summary\n")

    const ttyRuntime = makeRuntime()
    ttyRuntime.stdin.isTTY = true

    await expect(
      Effect.runPromise(
        runSession({
          runtime: ttyRuntime,
          modelGateway: makeModelGateway(() => Effect.succeed("summary")),
          config,
        }).pipe(Effect.provide(BunHttpClient.layer))
      )
    ).rejects.toBeInstanceOf(UsageError)
  })

  it("builds the live service and preserves usage errors", async () => {
    const runtime = captureRuntime()
    runtime.stdin.isTTY = true
    const service = await Effect.runPromise(
      DistillEngine.make.pipe(
        Effect.provide(
          Layer.mergeAll(
            runtime.runtimeLayer,
            Layer.succeed(ModelGateway)(makeModelGateway(() => Effect.succeed("unused")))
          )
        )
      )
    )

    await expect(
      Effect.runPromise(service.run(config).pipe(Effect.provide(BunHttpClient.layer)))
    ).rejects.toBeInstanceOf(UsageError)
  })

  it("wraps unexpected failures in DistillError and falls back to raw stdout", async () => {
    const runtime = captureRuntime()
    const service = await Effect.runPromise(
      DistillEngine.make.pipe(
        Effect.provide(
          Layer.mergeAll(
            runtime.runtimeLayer,
            Layer.succeed(ModelGateway)(
              makeModelGateway(() => Effect.fail(new ModelError({ detail: "boom" })))
            )
          )
        )
      )
    )

    const promise = Effect.runPromise(service.run(config).pipe(Effect.provide(BunHttpClient.layer)))
    runtime.stdin.emit("data", Buffer.from("raw input"))
    runtime.stdin.emit("end")

    await expect(promise).rejects.toBeInstanceOf(DistillError)
    expect(runtime.stdout.chunks.join("")).toBe("raw input")
  })

  it("exposes the live distill-engine layer", async () => {
    const runtime = captureRuntime()
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* DistillEngine
      }).pipe(
        Effect.provide(
          DistillEngine.Live.pipe(
            Layer.provide(
              Layer.mergeAll(
                runtime.runtimeLayer,
                Layer.succeed(ModelGateway)(makeModelGateway(() => Effect.succeed("unused")))
              )
            )
          )
        )
      )
    )

    expect(new DistillEngine(undefined as never)).toBeInstanceOf(DistillEngine)
    expect(service).toBeDefined()
  })
})
