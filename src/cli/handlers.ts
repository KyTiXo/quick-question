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
  maxTokens: Option.Option<string>
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
      maxTokens: optionToUndefined(input.maxTokens),
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
    maxTokens: number
    thinking: boolean
  }
) => [
  `path=${configPath}`,
  `provider=${effective.provider}`,
  `model=${effective.model}`,
  `host=${effective.host}`,
  `api-key=${maskSecret(effective.apiKey)}`,
  `timeout-ms=${String(effective.timeoutMs)}`,
  `max-tokens=${String(effective.maxTokens)}`,
  `thinking=${String(effective.thinking)}`,
]

const decodeKey = (keyInput: string) =>
  decodeConfigKey(keyInput).pipe(
    Effect.mapError(
      () =>
        new UsageError({
          detail: `Unknown config key: ${keyInput}`,
          exitCode: 2,
        })
    )
  )

const showEffectiveConfig = (
  configStore: typeof ConfigStore.Service,
  runtimeConfig: typeof RuntimeConfig.Service
) =>
  Effect.gen(function* () {
    const configPath = yield* configStore.resolvePath()
    const effective = yield* runtimeConfig.getEffectiveConfig()
    yield* writeLine(effectiveConfigLines(configPath, effective).join("\n"))
  })

const showConfigValue = (
  key: keyof typeof configFieldByKey,
  runtimeConfig: typeof RuntimeConfig.Service
) =>
  Effect.gen(function* () {
    const effective = yield* runtimeConfig.getEffectiveConfig()
    const field = configFieldByKey[key]
    const raw = effective[field]
    const value = key === "api-key" && typeof raw === "string" ? maskSecret(raw) : String(raw)
    yield* writeLine(value)
  })

const persistConfigValue = ({
  key,
  value,
  configStore,
  runtimeConfig,
}: {
  key: keyof typeof configFieldByKey
  value: string | number | boolean
  configStore: typeof ConfigStore.Service
  runtimeConfig: typeof RuntimeConfig.Service
}) =>
  Effect.gen(function* () {
    if (key === "model" && typeof value === "string") {
      const effective = yield* runtimeConfig.getEffectiveConfig()
      yield* configStore.setProviderModel(effective.provider, value)
    } else {
      if (key === "provider") {
        const effective = yield* runtimeConfig.getEffectiveConfig()
        yield* configStore.setProviderModel(effective.provider, effective.model)
      }

      yield* configStore.set(key, value)
    }

    yield* writeLine(`${key}=${String(value)}`)
  })

export const handleConfig = (input: { key: Option.Option<string>; value: ReadonlyArray<string> }) =>
  Effect.gen(function* () {
    const configStore = yield* ConfigStore
    const runtimeConfig = yield* RuntimeConfig
    const keyInput = optionToUndefined(input.key)

    if (keyInput === undefined) {
      yield* showEffectiveConfig(configStore, runtimeConfig)
      return
    }

    const key = yield* decodeKey(keyInput)

    if (input.value.length === 0) {
      yield* showConfigValue(key, runtimeConfig)
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
    yield* persistConfigValue({ key, value, configStore, runtimeConfig })
  })
