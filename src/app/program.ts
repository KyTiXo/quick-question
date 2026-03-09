import { BunRuntime, BunServices } from "@effect/platform-bun"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import * as Cause from "effect/Cause"
import type * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import type * as PlatformError from "effect/PlatformError"
import { CliError, Command } from "effect/unstable/cli"
import { VERSION } from "@/app/version"
import { qqCommand } from "@/cli/command"
import { Live } from "@/layers/live"
import { setExitCode, writeStderr } from "@/platform/stdio"
import type { ConfigStoreError, DistillError, UsageError } from "@/schema/errors"

export type HandledError =
  | CliError.CliError
  | UsageError
  | Config.ConfigError
  | PlatformError.PlatformError
  | ConfigStoreError
  | DistillError

export const failWith = (message: string, exitCode: number) =>
  Effect.gen(function* () {
    yield* setExitCode(exitCode)
    yield* writeStderr(`${message}\n`)
  })

const hasTag = (error: unknown): error is { _tag: string; message: string } =>
  typeof error === "object" && error !== null && "_tag" in error && "message" in error

export const handleError = (error: HandledError) => {
  if (CliError.isCliError(error) && error._tag === "ShowHelp") {
    return setExitCode(error.errors.length === 0 ? 0 : 2)
  }

  if (CliError.isCliError(error)) {
    return failWith(error.message, 2)
  }

  if (hasTag(error) && error._tag === "UsageError") {
    return failWith(error.message, error.exitCode)
  }

  if (hasTag(error) && (error._tag === "ConfigStoreError" || error._tag === "DistillError")) {
    return failWith(error.message, 1)
  }

  return failWith(error instanceof Error ? error.message : "Unexpected error.", 1)
}

export const handleDefect = (cause: Cause.Cause<unknown>) => failWith(Cause.pretty(cause), 1)

export const isHandledError = (error: unknown): error is HandledError =>
  CliError.isCliError(error) ||
  (hasTag(error) &&
    (error._tag === "UsageError" ||
      error._tag === "ConfigStoreError" ||
      error._tag === "DistillError"))

export const buildProgram = () =>
  Command.run(qqCommand, { version: VERSION }).pipe(
    Effect.catchIf(CliError.isCliError, handleError),
    Effect.catchTags({
      UsageError: handleError,
      ConfigStoreError: handleError,
      DistillError: handleError,
    }),
    Effect.sandbox,
    Effect.catchCause(handleDefect),
    Effect.provide(Live),
    Effect.provide(BunHttpClient.layer),
    Effect.provide(BunServices.layer)
  )

export const runtimeOps = {
  runMain: BunRuntime.runMain,
}

export const runMain = () =>
  runtimeOps.runMain(buildProgram(), {
    disableErrorReporting: true,
  })
