import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ServiceMap from "effect/ServiceMap"

export interface RuntimeInput {
  isTTY?: boolean
  on(event: "data", listener: (chunk: string | Uint8Array) => void): unknown
  on(event: "end", listener: () => void): unknown
  on(event: "error", listener: (error: unknown) => void): unknown
  off?(event: "data", listener: (chunk: string | Uint8Array) => void): unknown
  off?(event: "end", listener: () => void): unknown
  off?(event: "error", listener: (error: unknown) => void): unknown
  resume(): unknown
}

export interface RuntimeWriter {
  isTTY?: boolean
  write(chunk: string | Uint8Array): unknown
}

export interface RuntimeLike {
  env: Record<string, string | undefined>
  stdin: RuntimeInput
  stdout: RuntimeWriter
  stderr: RuntimeWriter
  setExitCode?: (code: number) => void
}

const makeRuntime = ({
  getEnv,
  stdin,
  stdout,
  stderr,
  setExitCode,
}: {
  getEnv: () => Record<string, string | undefined>
  stdin: RuntimeInput
  stdout: RuntimeWriter
  stderr: RuntimeWriter
  setExitCode?: (code: number) => void
}) => ({
  getEnv: Effect.sync(getEnv),
  stdin,
  stdout,
  stderr,
  setExitCode: (code: number) =>
    Effect.sync(() => {
      setExitCode?.(code)
    }),
})

export class AppRuntime extends ServiceMap.Service<AppRuntime>()("AppRuntime", {
  make: Effect.succeed(
    makeRuntime({
      getEnv: () => process.env as Record<string, string | undefined>,
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      setExitCode: (code) => {
        process.exitCode = code
      },
    })
  ),
}) {
  static Live = Layer.effect(this, this.make)

  static layerFor = (runtime: RuntimeLike) =>
    Layer.succeed(this)(
      makeRuntime({
        getEnv: () => runtime.env,
        stdin: runtime.stdin,
        stdout: runtime.stdout,
        stderr: runtime.stderr,
        setExitCode: runtime.setExitCode,
      })
    )
}
