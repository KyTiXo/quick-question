import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import { setExitCode, writeStderr, writeStdout } from "@/platform/stdio"

import { captureRuntime } from "./support"

describe("platform/stdio", () => {
  it("writes stdout, stderr, and exit codes through Effect stdio", async () => {
    const runtime = captureRuntime()

    await Effect.runPromise(
      Effect.all([
        writeStdout("out"),
        writeStderr(Uint8Array.from(Buffer.from("err"))),
        setExitCode(7),
      ]).pipe(Effect.provide(runtime.layer))
    )

    expect(runtime.stdout.chunks.join("")).toBe("out")
    expect(runtime.stderr.chunks.join("")).toBe("err")
    expect(runtime.getExitCode()).toBe(7)
  })
})
