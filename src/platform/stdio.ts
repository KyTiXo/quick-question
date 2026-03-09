import * as Stdio from "effect/Stdio"
import * as Stream from "effect/Stream"
import { AppRuntime } from "@/platform/runtime"

const writeWith = (
  select: (
    stdio: Stdio.Stdio
  ) => (options?: { readonly endOnDone?: boolean }) => ReturnType<Stdio.Stdio["stdout"]>,
  chunk: string | Uint8Array
) =>
  Stdio.Stdio.use((stdio) =>
    Stream.make(chunk).pipe(Stream.run(select(stdio)({ endOnDone: false })))
  )

export const writeStdout = (chunk: string | Uint8Array) => writeWith((stdio) => stdio.stdout, chunk)

export const writeStderr = (chunk: string | Uint8Array) => writeWith((stdio) => stdio.stderr, chunk)

export const setExitCode = (code: number) => AppRuntime.use((runtime) => runtime.setExitCode(code))
