import * as Config from "effect/Config"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as ServiceMap from "effect/ServiceMap"
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  DEFAULT_TIMEOUT_MS,
  defaultHostFor,
  envKeys,
  falsyValues,
  joinQuestion,
  normalizeHost,
  trimToUndefined,
  truthyValues,
} from "@/domain/config"
import { AppRuntime } from "@/platform/runtime"
import type { ConfigKey, PersistedConfig, Provider, ResolvedRunConfig } from "@/schema/config"
import { UsageError } from "@/schema/errors"
import { ConfigStore } from "@/services/config-store"

const EnvConfig = Config.all({
  provider: Config.string(envKeys.provider).pipe(Config.withDefault("")),
  model: Config.string(envKeys.model).pipe(Config.withDefault("")),
  host: Config.string(envKeys.host).pipe(Config.withDefault("")),
  timeoutMs: Config.string(envKeys.timeoutMs).pipe(Config.withDefault("")),
  thinking: Config.string(envKeys.thinking).pipe(Config.withDefault("")),
  ollamaHost: Config.string(envKeys.ollamaHost).pipe(Config.withDefault("")),
  openAiBaseUrl: Config.string(envKeys.openAiBaseUrl).pipe(Config.withDefault("")),
  openAiApiKey: Config.string(envKeys.openAiApiKey).pipe(Config.withDefault("")),
})

const loadEnv = (env: Record<string, string | undefined>) =>
  EnvConfig.parse(
    ConfigProvider.fromEnv({
      env: Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
      ),
    })
  )

const usageError = (detail: string) => new UsageError({ detail, exitCode: 2 })

const parseProvider = (raw: string) => {
  const value = raw.trim().toLowerCase()

  if (value === "ollama" || value === "openai") {
    return Option.some(value as Provider)
  }

  return Option.none<Provider>()
}

const parseBoolean = (raw: string) => {
  const value = raw.trim().toLowerCase()

  if (truthyValues.has(value)) {
    return Option.some(true)
  }

  if (falsyValues.has(value)) {
    return Option.some(false)
  }

  return Option.none<boolean>()
}

const parseTimeout = (raw: string) => {
  const value = Number(raw)

  if (!Number.isFinite(value) || value <= 0) {
    return Option.none<number>()
  }

  return Option.some(Math.floor(value))
}

const parseProviderValue = (raw: string, label: string) =>
  Option.match(parseProvider(raw), {
    onNone: () => Effect.fail(usageError(`${label} must be "ollama" or "openai".`)),
    onSome: Effect.succeed,
  })

const parseBooleanValue = (raw: string, label: string) =>
  Option.match(parseBoolean(raw), {
    onNone: () => Effect.fail(usageError(`${label} must be true or false.`)),
    onSome: Effect.succeed,
  })

const parseTimeoutValue = (raw: string) =>
  Option.match(parseTimeout(raw), {
    onNone: () => Effect.fail(usageError("Timeout must be a positive number.")),
    onSome: Effect.succeed,
  })

const parseHostValue = (raw: string) => {
  const normalized = normalizeHost(raw)

  if (!normalized) {
    return Effect.fail(usageError("Host cannot be empty."))
  }

  return Effect.succeed(normalized)
}

const parseModelValue = (raw: string) => {
  const trimmed = raw.trim()

  if (!trimmed) {
    return Effect.fail(usageError("Model cannot be empty."))
  }

  return Effect.succeed(trimmed)
}

interface EnvValues {
  provider: string
  model: string
  host: string
  timeoutMs: string
  thinking: string
  ollamaHost: string
  openAiBaseUrl: string
  openAiApiKey: string
}

const pickString = (...values: Array<string | undefined>) => {
  for (const value of values) {
    const trimmed = trimToUndefined(value)

    if (trimmed !== undefined) {
      return trimmed
    }
  }
}

const envHostForProvider = (env: EnvValues, provider: Provider) =>
  provider === "openai"
    ? pickString(env.openAiBaseUrl, env.host)
    : pickString(env.ollamaHost, env.host)

const resolveProviderInput = ({
  cli,
  env,
  persisted,
}: {
  cli?: string
  env?: string
  persisted?: Provider
}) => {
  const raw = pickString(cli, env)

  return raw ? parseProviderValue(raw, "Provider") : Effect.succeed(persisted ?? DEFAULT_PROVIDER)
}

const resolveModelInput = (...values: Array<string | undefined>) =>
  parseModelValue(pickString(...values) ?? DEFAULT_MODEL)

const resolveHostInput = ({
  provider,
  cli,
  env,
  persisted,
}: {
  provider: Provider
  cli?: string
  env?: string
  persisted?: string
}) =>
  parseHostValue(
    pickString(cli, env, persisted, defaultHostFor(provider)) ?? defaultHostFor(provider)
  )

const resolveTimeoutInput = ({
  cli,
  env,
  persisted,
}: {
  cli?: string
  env?: string
  persisted?: number
}) => {
  const raw = pickString(cli, env)

  return raw ? parseTimeoutValue(raw) : Effect.succeed(persisted ?? DEFAULT_TIMEOUT_MS)
}

const resolveThinkingInput = ({
  cli,
  env,
  persisted,
}: {
  cli?: string
  env?: string
  persisted?: boolean
}) => {
  const raw = pickString(cli, env)

  return raw ? parseBooleanValue(raw, "Thinking") : Effect.succeed(persisted ?? false)
}

const resolveQuestion = (parts: ReadonlyArray<string>) => {
  const question = joinQuestion(parts)

  return question ? Effect.succeed(question) : Effect.fail(usageError("A question is required."))
}

const requireOpenAiApiKey = (provider: Provider, apiKey: string) =>
  provider === "openai" && !apiKey
    ? Effect.fail(
        usageError(
          "An API key is required for the openai provider. Set OPENAI_API_KEY or use --api-key."
        )
      )
    : Effect.void

const makeDefaults = (env: EnvValues) =>
  Effect.gen(function* () {
    const provider = yield* resolveProviderInput({
      env: env.provider,
    })

    return {
      provider,
      model: yield* resolveModelInput(env.model),
      host: yield* resolveHostInput({
        provider,
        env: envHostForProvider(env, provider),
      }),
      apiKey: pickString(env.openAiApiKey) ?? "",
      timeoutMs: yield* resolveTimeoutInput({
        env: env.timeoutMs,
      }),
      thinking: yield* resolveThinkingInput({
        env: env.thinking,
      }),
    }
  })

const makeEffectiveConfig = ({ env, persisted }: { env: EnvValues; persisted: PersistedConfig }) =>
  Effect.gen(function* () {
    const provider = yield* resolveProviderInput({
      env: env.provider,
      persisted: persisted.provider,
    })

    return {
      provider,
      model: yield* resolveModelInput(env.model, persisted.model),
      host: yield* resolveHostInput({
        provider,
        env: envHostForProvider(env, provider),
        persisted: persisted.host,
      }),
      apiKey: pickString(env.openAiApiKey, persisted.apiKey) ?? "",
      timeoutMs: yield* resolveTimeoutInput({
        env: env.timeoutMs,
        persisted: persisted.timeoutMs,
      }),
      thinking: yield* resolveThinkingInput({
        env: env.thinking,
        persisted: persisted.thinking,
      }),
    }
  })

const makeResolvedRunConfig = ({
  input,
  env,
  persisted,
}: {
  input: CliRunInput
  env: EnvValues
  persisted: PersistedConfig
}) =>
  Effect.gen(function* () {
    const provider = yield* resolveProviderInput({
      cli: input.provider,
      env: env.provider,
      persisted: persisted.provider,
    })
    const apiKey = pickString(input.apiKey, env.openAiApiKey, persisted.apiKey) ?? ""

    yield* requireOpenAiApiKey(provider, apiKey)

    return {
      question: yield* resolveQuestion(input.question),
      provider,
      model: yield* resolveModelInput(input.model, env.model, persisted.model),
      host: yield* resolveHostInput({
        provider,
        cli: input.host,
        env: envHostForProvider(env, provider),
        persisted: persisted.host,
      }),
      apiKey,
      timeoutMs: yield* resolveTimeoutInput({
        cli: input.timeoutMs,
        env: env.timeoutMs,
        persisted: persisted.timeoutMs,
      }),
      thinking: yield* resolveThinkingInput({
        cli: input.thinking,
        env: env.thinking,
        persisted: persisted.thinking,
      }),
    }
  })

export interface CliRunInput {
  question: ReadonlyArray<string>
  provider?: string
  model?: string
  host?: string
  apiKey?: string
  timeoutMs?: string
  thinking?: string
}

export type RuntimeDefaults = Omit<ResolvedRunConfig, "question">

export class RuntimeConfig extends ServiceMap.Service<RuntimeConfig>()("RuntimeConfig", {
  make: Effect.gen(function* () {
    const configStore = yield* ConfigStore
    const runtime = yield* AppRuntime

    const defaults = () =>
      Effect.gen(function* () {
        const env = yield* runtime.getEnv.pipe(Effect.flatMap(loadEnv))
        return yield* makeDefaults(env)
      })

    const getEffectiveConfig = () =>
      Effect.gen(function* () {
        const persisted = yield* configStore.read()
        const env = yield* runtime.getEnv.pipe(Effect.flatMap(loadEnv))
        return yield* makeEffectiveConfig({ env, persisted })
      })

    return {
      defaults,
      getEffectiveConfig,
      parseConfigValue: (key: ConfigKey, raw: string) => {
        switch (key) {
          case "provider":
            return parseProviderValue(raw, "Provider")
          case "thinking":
            return parseBooleanValue(raw, "Thinking")
          case "timeout-ms":
            return parseTimeoutValue(raw)
          case "host":
            return parseHostValue(raw)
          case "model":
          case "api-key":
            return Effect.succeed(raw.trim())
        }
      },
      resolveRunConfig: (input: CliRunInput) =>
        Effect.gen(function* () {
          const persisted = yield* configStore.read()
          const env = yield* runtime.getEnv.pipe(Effect.flatMap(loadEnv))
          return yield* makeResolvedRunConfig({
            input,
            env,
            persisted,
          })
        }),
    }
  }),
}) {
  static Live = Layer.effect(this, this.make)
}
