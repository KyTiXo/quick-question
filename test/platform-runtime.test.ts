import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import { AppRuntime } from "@/platform/runtime"

describe("platform/runtime", () => {
  let originalEnv: NodeJS.ProcessEnv
  let savedExitCode: number | undefined

  beforeEach(() => {
    originalEnv = { ...process.env }
    const raw = process.exitCode
    savedExitCode = typeof raw === "number" ? raw : undefined
  })

  afterEach(() => {
    process.env = originalEnv
    process.exitCode = savedExitCode ?? 0
  })

  it("provides AppRuntime.Live with process.env, stdin, stdout, stderr, and setExitCode", async () => {
    process.env["QQ_TEST_VAR"] = "live-value"

    const program = Effect.gen(function* () {
      const runtime = yield* AppRuntime
      const env = yield* runtime.getEnv
      expect(env.QQ_TEST_VAR).toBe("live-value")
      yield* runtime.setExitCode(42)
    })

    await Effect.runPromise(program.pipe(Effect.provide(AppRuntime.Live)))

    expect(process.exitCode).toBe(42)
    process.exitCode = savedExitCode
  })

  it("layerFor provides a custom runtime with given env and setExitCode", async () => {
    let exitCode: number | undefined
    const customEnv = { CUSTOM_KEY: "custom-value" }

    const layer = AppRuntime.layerFor({
      env: customEnv,
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      setExitCode: (code) => {
        exitCode = code
      },
    })

    const program = Effect.gen(function* () {
      const runtime = yield* AppRuntime
      const env = yield* runtime.getEnv
      expect(env.CUSTOM_KEY).toBe("custom-value")
      yield* runtime.setExitCode(7)
    })

    await Effect.runPromise(program.pipe(Effect.provide(layer)))

    expect(exitCode).toBe(7)
  })
})
