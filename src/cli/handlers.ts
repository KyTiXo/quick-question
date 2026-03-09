import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { configFieldByKey, maskSecret } from "@/domain/config"
import { writeStdout } from "@/platform/stdio"
import { decodeConfigKey } from "@/schema/config"
import { UsageError } from "@/schema/errors"
import { ConfigStore } from "@/services/config-store"
import { DistillEngine } from "@/services/distill-engine"
import { type CliRunInput, RuntimeConfig } from "@/services/runtime-config"

const optionToUndefined = <A>(option: Option.Option<A>) =>
  Option.match(option, {
    onNone: () => undefined,
    onSome: (value) => value,
  })

const writeLine = (line: string) => writeStdout(`${line}\n`)

export const handleRun = (input: {
  question: ReadonlyArray<string>
  provider: Option.Option<string>
  model: Option.Option<string>
  host: Option.Option<string>
  apiKey: Option.Option<string>
  timeoutMs: Option.Option<string>
  thinking: Option.Option<string>
}) =>
  Effect.gen(function* () {
    const runtimeConfig = yield* RuntimeConfig
    const distillEngine = yield* DistillEngine

    const config = yield* runtimeConfig.resolveRunConfig({
      question: input.question,
      provider: optionToUndefined(input.provider),
      model: optionToUndefined(input.model),
      host: optionToUndefined(input.host),
      apiKey: optionToUndefined(input.apiKey),
      timeoutMs: optionToUndefined(input.timeoutMs),
      thinking: optionToUndefined(input.thinking),
    } satisfies CliRunInput)

    yield* distillEngine.run(config)
  })

const effectiveConfigLines = (
  configPath: string,
  effective: {
    provider: string
    model: string
    host: string
    apiKey: string
    timeoutMs: number
    thinking: boolean
  }
) => [
  `path=${configPath}`,
  `provider=${effective.provider}`,
  `model=${effective.model}`,
  `host=${effective.host}`,
  `api-key=${maskSecret(effective.apiKey)}`,
  `timeout-ms=${String(effective.timeoutMs)}`,
  `thinking=${String(effective.thinking)}`,
]

export const handleConfig = (input: { key: Option.Option<string>; value: ReadonlyArray<string> }) =>
  Effect.gen(function* () {
    const configStore = yield* ConfigStore
    const runtimeConfig = yield* RuntimeConfig
    const keyInput = optionToUndefined(input.key)

    if (keyInput === undefined) {
      const configPath = yield* configStore.resolvePath()
      const effective = yield* runtimeConfig.getEffectiveConfig()
      const lines = effectiveConfigLines(configPath, effective)
      yield* writeLine(lines.join("\n"))
      return
    }

    const key = yield* decodeConfigKey(keyInput).pipe(
      Effect.mapError(
        () =>
          new UsageError({
            detail: `Unknown config key: ${keyInput}`,
            exitCode: 2,
          })
      )
    )

    if (input.value.length === 0) {
      const effective = yield* runtimeConfig.getEffectiveConfig()
      const field = configFieldByKey[key]
      const raw = effective[field]
      const value = key === "api-key" && typeof raw === "string" ? maskSecret(raw) : String(raw)
      yield* writeLine(value)
      return
    }

    const rawValue = input.value.join(" ").trim()

    if (!rawValue) {
      return yield* Effect.fail(
        new UsageError({
          detail: `Missing value for config key ${key}.`,
          exitCode: 2,
        })
      )
    }

    const value = yield* runtimeConfig.parseConfigValue(key, rawValue)
    yield* configStore.set(key, value)
    yield* writeLine(`${key}=${String(value)}`)
  })
