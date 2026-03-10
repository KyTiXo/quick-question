import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ConfigStore } from "@/services/config-store"
import { RuntimeConfig } from "@/services/runtime-config"

import { captureRuntime, getEffectError } from "./support"

const makeConfigStoreService = (persisted = {}) =>
  ({
    resolvePath: () => Effect.die(new Error("unused")),
    read: () => Effect.succeed(persisted),
    get: () => Effect.die(new Error("unused")),
    setProviderModel: () => Effect.void,
    set: () => Effect.void,
    showLines: () => Effect.succeed([]),
  }) satisfies typeof ConfigStore.Service

const makeRuntimeConfig = (persisted = {}, env: Record<string, string | undefined> = {}) =>
  Effect.runPromise(
    RuntimeConfig.make.pipe(
      Effect.provide(
        Layer.mergeAll(
          captureRuntime({ env }).runtimeLayer,
          Layer.succeed(ConfigStore)(makeConfigStoreService(persisted))
        )
      )
    )
  )

describe("services/runtime-config", () => {
  it("returns effective config (env + persisted + defaults)", async () => {
    const runtimeConfig = await makeRuntimeConfig(
      { model: "persisted-model", timeoutMs: 5000 },
      { QQ_HOST: "http://env-host" }
    )
    const effective = await Effect.runPromise(runtimeConfig.getEffectiveConfig())

    expect(effective.provider).toBe("ollama")
    expect(effective.model).toBe("persisted-model")
    expect(effective.host).toBe("http://env-host")
    expect(effective.timeoutMs).toBe(5000)
    expect(effective.maxTokens).toBe(200)
  })

  it("uses local provider defaults and blanks ignored remote fields", async () => {
    const runtimeConfig = await makeRuntimeConfig(
      {
        provider: "local",
        host: "http://persisted-host",
        apiKey: "persisted-key",
      },
      {
        QQ_HOST: "http://env-host",
        OPENAI_API_KEY: "env-key",
      }
    )
    const effective = await Effect.runPromise(runtimeConfig.getEffectiveConfig())

    expect(effective.provider).toBe("local")
    expect(effective.model).toBe("hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf")
    expect(effective.host).toBe("")
    expect(effective.apiKey).toBe("")
    expect(effective.maxTokens).toBe(200)
  })

  it("resolves provider-specific persisted models when switching providers", async () => {
    const runtimeConfig = await makeRuntimeConfig({
      provider: "local",
      model: "legacy-model",
      providerModels: {
        ollama: "qwen3.5:2b",
        local: "hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf",
      },
    })

    const localEffective = await Effect.runPromise(runtimeConfig.getEffectiveConfig())
    const ollamaResolved = await Effect.runPromise(
      runtimeConfig.resolveRunConfig({
        question: ["what", "changed?"],
        provider: "ollama",
      })
    )

    expect(localEffective.model).toBe("hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf")
    expect(ollamaResolved.model).toBe("qwen3.5:2b")
  })

  it("loads defaults from env", async () => {
    const runtimeConfig = await makeRuntimeConfig(
      {},
      {
        QQ_PROVIDER: "openai",
        QQ_MODEL: "gpt-test",
        QQ_TIMEOUT_MS: "321",
        QQ_MAX_TOKENS: "654",
        QQ_THINKING: "true",
        OPENAI_BASE_URL: "https://api.example.com",
        OPENAI_API_KEY: "sk-test",
      }
    )
    const defaults = await Effect.runPromise(runtimeConfig.defaults())

    expect(defaults).toEqual({
      provider: "openai",
      model: "gpt-test",
      host: "https://api.example.com",
      apiKey: "sk-test",
      timeoutMs: 321,
      maxTokens: 654,
      thinking: true,
    })
  })

  it("resolves cli, env, persisted, and default precedence", async () => {
    const runtimeConfig = await makeRuntimeConfig(
      {
        provider: "openai",
        model: "persisted-model",
        host: "http://persisted-host",
        apiKey: "persisted-key",
        timeoutMs: 20,
        maxTokens: 40,
        thinking: true,
      },
      {
        QQ_PROVIDER: "ollama",
        QQ_MODEL: "env-model",
        QQ_HOST: "http://env-host",
        QQ_TIMEOUT_MS: "10",
        QQ_MAX_TOKENS: "15",
        QQ_THINKING: "false",
        OPENAI_API_KEY: "env-key",
      }
    )

    const config = await Effect.runPromise(
      runtimeConfig.resolveRunConfig({
        question: ["what", "changed?"],
        provider: "openai",
        model: "cli-model",
        host: "http://cli-host/",
        apiKey: "cli-key",
        timeoutMs: "30",
        maxTokens: "60",
        thinking: "true",
      })
    )

    expect(config).toEqual({
      question: "what changed?",
      provider: "openai",
      model: "cli-model",
      host: "http://cli-host",
      apiKey: "cli-key",
      timeoutMs: 30,
      maxTokens: 60,
      thinking: true,
    })
  })

  it("supports LOCAL_COMPLETION_MAX_TOKENS as an env alias", async () => {
    const runtimeConfig = await makeRuntimeConfig({}, { LOCAL_COMPLETION_MAX_TOKENS: "222" })
    const defaults = await Effect.runPromise(runtimeConfig.defaults())

    expect(defaults.maxTokens).toBe(222)
  })

  it("parses config values and rejects invalid input", async () => {
    const runtimeConfig = await makeRuntimeConfig()
    const provider = await Effect.runPromise(
      runtimeConfig.parseConfigValue("provider", "openai").pipe(Effect.map(String))
    )
    const thinking = await Effect.runPromise(
      runtimeConfig.parseConfigValue("thinking", "yes").pipe(Effect.map(String))
    )
    const timeout = await Effect.runPromise(
      runtimeConfig.parseConfigValue("timeout-ms", "4.9").pipe(Effect.map(String))
    )
    const maxTokens = await Effect.runPromise(
      runtimeConfig.parseConfigValue("max-tokens", "9.9").pipe(Effect.map(String))
    )
    const host = await Effect.runPromise(
      runtimeConfig.parseConfigValue("host", " http://host/// ").pipe(Effect.map(String))
    )
    const model = await Effect.runPromise(
      runtimeConfig.parseConfigValue("model", " model ").pipe(Effect.map(String))
    )
    const apiKey = await Effect.runPromise(
      runtimeConfig.parseConfigValue("api-key", " key ").pipe(Effect.map(String))
    )

    expect(provider).toBe("openai")
    expect(thinking).toBe("true")
    expect(timeout).toBe("4")
    expect(maxTokens).toBe("9")
    expect(host).toBe("http://host")
    expect(model).toBe("model")
    expect(apiKey).toBe("key")

    const providerError = await getEffectError(
      runtimeConfig.parseConfigValue("provider", "bad") as Effect.Effect<never, unknown>
    )
    const thinkingError = await getEffectError(
      runtimeConfig.parseConfigValue("thinking", "maybe") as Effect.Effect<never, unknown>
    )
    const timeoutError = await getEffectError(
      runtimeConfig.parseConfigValue("timeout-ms", "0") as Effect.Effect<never, unknown>
    )
    const maxTokensError = await getEffectError(
      runtimeConfig.parseConfigValue("max-tokens", "0") as Effect.Effect<never, unknown>
    )
    const hostError = await getEffectError(
      runtimeConfig.parseConfigValue("host", "   ") as Effect.Effect<never, unknown>
    )

    expect((providerError as Error).message).toBe(
      'Provider must be "ollama", "openai", or "local".'
    )
    expect((thinkingError as Error).message).toBe("Thinking must be true or false.")
    expect((timeoutError as Error).message).toBe("Timeout must be a positive number.")
    expect((maxTokensError as Error).message).toBe("Max tokens must be a positive number.")
    expect((hostError as Error).message).toBe("Host cannot be empty.")
  })

  it("rejects missing questions and missing openai api keys", async () => {
    const runtimeConfig = await makeRuntimeConfig()

    const missingQuestionError = await getEffectError(
      runtimeConfig.resolveRunConfig({
        question: [],
      })
    )
    const missingApiKeyError = await getEffectError(
      runtimeConfig.resolveRunConfig({
        question: ["hi"],
        provider: "openai",
      })
    )

    expect((missingQuestionError as Error).message).toBe("A question is required.")
    expect((missingApiKeyError as Error).message).toBe(
      "An API key is required for the openai provider. Set OPENAI_API_KEY or use --api-key."
    )

    expect(
      await Effect.runPromise(
        runtimeConfig.resolveRunConfig({
          question: ["hi"],
          provider: "local",
          apiKey: "unused",
          host: "http://ignored",
        })
      )
    ).toEqual({
      question: "hi",
      provider: "local",
      model: "hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf",
      host: "",
      apiKey: "",
      timeoutMs: 90_000,
      maxTokens: 200,
      thinking: false,
    })
  })

  it("exposes the live runtime-config layer", async () => {
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* RuntimeConfig
      }).pipe(
        Effect.provide(
          RuntimeConfig.Live.pipe(
            Layer.provide(
              Layer.mergeAll(
                captureRuntime().runtimeLayer,
                Layer.succeed(ConfigStore)(makeConfigStoreService())
              )
            )
          )
        )
      )
    )

    expect(new RuntimeConfig(undefined as never)).toBeInstanceOf(RuntimeConfig)
    expect(service).toBeDefined()
  })
})
