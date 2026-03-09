import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ServiceMap from "effect/ServiceMap"
import { buildBatchPrompt, buildWatchPrompt } from "@/domain/prompt"
import { StreamSession } from "@/domain/stream-session"
import { AppRuntime, type RuntimeInput, type RuntimeLike } from "@/platform/runtime"
import type { ResolvedRunConfig } from "@/schema/config"
import { DistillError, UsageError } from "@/schema/errors"
import { ModelGateway } from "@/services/model-gateway"

export const usageError = () =>
  new UsageError({
    detail: "stdin is required.",
    exitCode: 2,
  })

export const progressOptions = (runtime: RuntimeLike) => {
  const protocol = runtime.env.QQ_PROGRESS_PROTOCOL === "stderr"

  return {
    progress: protocol ? undefined : [runtime.stderr, runtime.stdout].find((s) => s.isTTY),
    onProgressPhase: protocol
      ? (phase: "collecting" | "summarizing") => {
          runtime.stderr.write(`__QQ_PROGRESS__:phase:${phase}\n`)
        }
      : undefined,
    onProgressStop: protocol
      ? () => {
          runtime.stderr.write("__QQ_PROGRESS__:stop\n")
        }
      : undefined,
  }
}

export const readIntoSession = (stdin: RuntimeInput, session: StreamSession) =>
  Effect.scoped(
    Effect.gen(function* () {
      const listenerState = yield* Effect.acquireRelease(
        Effect.sync(() => {
          let resolve: (value: void | PromiseLike<void>) => void = () => {}
          let reject: (reason?: unknown) => void = () => {}
          const done = new Promise<void>((innerResolve, innerReject) => {
            resolve = innerResolve
            reject = innerReject
          })
          const onData = (chunk: string | Uint8Array) => {
            session.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          }
          const onEnd = () => {
            resolve()
          }
          const onError = (error: unknown) => {
            reject(error)
          }

          stdin.on("data", onData)
          stdin.on("end", onEnd)
          stdin.on("error", onError)
          stdin.resume()

          return {
            done,
            cleanup: () => {
              stdin.off?.("data", onData)
              stdin.off?.("end", onEnd)
              stdin.off?.("error", onError)
            },
          }
        }),
        ({ cleanup }) =>
          Effect.sync(() => {
            cleanup()
          })
      )

      yield* Effect.promise(() => listenerState.done)
    })
  )

export const summarizerFor = (
  modelGateway: typeof ModelGateway.Service,
  config: ResolvedRunConfig
) => ({
  summarizeBatch: (input: string) =>
    Effect.runPromise(
      modelGateway.generateText({
        config,
        prompt: buildBatchPrompt(config.question, input),
      })
    ),
  summarizeWatch: (previousCycle: string, currentCycle: string) =>
    Effect.runPromise(
      modelGateway.generateText({
        config,
        prompt: buildWatchPrompt(config.question, previousCycle, currentCycle),
      })
    ),
})

export const runSession = ({
  runtime,
  modelGateway,
  config,
}: {
  runtime: RuntimeLike
  modelGateway: typeof ModelGateway.Service
  config: ResolvedRunConfig
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      if (runtime.stdin.isTTY) {
        return yield* Effect.fail(usageError())
      }

      const session = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new StreamSession({
              summarizer: summarizerFor(modelGateway, config),
              stdout: runtime.stdout,
              isTTY: Boolean(runtime.stdout.isTTY),
              ...progressOptions(runtime),
            })
        ),
        (session) =>
          Effect.sync(() => {
            session.dispose()
          })
      )

      yield* readIntoSession(runtime.stdin, session)
      yield* Effect.tryPromise({
        try: () => session.end(),
        catch: (cause) =>
          new DistillError({
            detail: "qq failed while processing stdin.",
            cause,
          }),
      })
    })
  )

export class DistillEngine extends ServiceMap.Service<DistillEngine>()("DistillEngine", {
  make: Effect.gen(function* () {
    const modelGateway = yield* ModelGateway
    const runtime = yield* AppRuntime

    return {
      run: (config: ResolvedRunConfig) =>
        Effect.gen(function* () {
          const env = yield* runtime.getEnv

          return yield* runSession({
            runtime: {
              env,
              stdin: runtime.stdin,
              stdout: runtime.stdout,
              stderr: runtime.stderr,
            },
            modelGateway,
            config,
          }).pipe(
            Effect.catch(
              (cause): Effect.Effect<never, UsageError | DistillError> =>
                cause instanceof UsageError || cause instanceof DistillError
                  ? Effect.fail(cause)
                  : Effect.fail(
                      new DistillError({
                        detail: "qq failed while processing stdin.",
                        cause,
                      })
                    )
            )
          )
        }),
    }
  }),
}) {
  static Live = Layer.effect(this, this.make)
}
