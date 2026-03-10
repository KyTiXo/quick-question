import { EventEmitter } from "node:events"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Sink from "effect/Sink"
import * as Stdio from "effect/Stdio"
import { AppRuntime, type RuntimeInput } from "@/platform/runtime"

export const asText = (chunk: string | Uint8Array) =>
  typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")

export const makeWriter = (isTTY = false) => {
  const chunks: Array<string> = []

  return {
    isTTY,
    chunks,
    write: (chunk: string | Uint8Array) => {
      chunks.push(asText(chunk))
    },
  }
}

export class TestInput extends EventEmitter implements RuntimeInput {
  isTTY = false
  resumed = false

  resume() {
    this.resumed = true
  }
}

export const captureRuntime = ({
  env = {},
  stdin = new TestInput(),
  stdout = makeWriter(),
  stderr = makeWriter(),
}: {
  env?: Record<string, string | undefined>
  stdin?: TestInput
  stdout?: ReturnType<typeof makeWriter>
  stderr?: ReturnType<typeof makeWriter>
} = {}) => {
  let exitCode: number | undefined

  const runtimeLayer = AppRuntime.layerFor({
    env,
    stdin,
    stdout,
    stderr,
    setExitCode: (code) => {
      exitCode = code
    },
  })
  const stdioLayer = Stdio.layerTest({
    stdout: () => Sink.forEach((chunk) => Effect.sync(() => stdout.write(chunk))),
    stderr: () => Sink.forEach((chunk) => Effect.sync(() => stderr.write(chunk))),
  })

  return {
    stdin,
    stdout,
    stderr,
    runtimeLayer,
    stdioLayer,
    layer: Layer.mergeAll(runtimeLayer, stdioLayer),
    getExitCode: () => exitCode,
  }
}

export const fetchLayer = (
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
) =>
  Layer.mergeAll(
    BunHttpClient.layer,
    Layer.succeed(BunHttpClient.Fetch)(((input: string | URL | Request, init?: RequestInit) =>
      fetchImpl(
        input instanceof Request
          ? input
          : new Request(typeof input === "string" ? input : input.toString(), init)
      )) as typeof fetch)
  )
