import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ConfigStore } from "@/services/config-store"
import { RuntimeConfig } from "@/services/runtime-config"

import { captureRuntime } from "./support"

const makeConfigStoreService = (persisted = {}) =>
  ({
    resolvePath: () => Effect.die(new Error("unused")),
    read: () => Effect.succeed(persisted),
    get: () => Effect.die(new Error("unused")),
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
  })

  it("loads defaults from env", async () => {
    const runtimeConfig = await makeRuntimeConfig(
      {},
      {
        QQ_PROVIDER: "openai",
        QQ_MODEL: "gpt-test",
        QQ_TIMEOUT_MS: "321",
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
        thinking: true,
      },
      {
        QQ_PROVIDER: "ollama",
        QQ_MODEL: "env-model",
        QQ_HOST: "http://env-host",
        QQ_TIMEOUT_MS: "10",
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
      thinking: true,
    })
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
    expect(host).toBe("http://host")
    expect(model).toBe("model")
    expect(apiKey).toBe("key")

    await expect(
      Effect.runPromise(
        runtimeConfig.parseConfigValue("provider", "bad") as Effect.Effect<never, unknown>
      )
    ).rejects.toThrow('Provider must be "ollama" or "openai".')
    await expect(
      Effect.runPromise(
        runtimeConfig.parseConfigValue("thinking", "maybe") as Effect.Effect<never, unknown>
      )
    ).rejects.toThrow("Thinking must be true or false.")
    await expect(
      Effect.runPromise(
        runtimeConfig.parseConfigValue("timeout-ms", "0") as Effect.Effect<never, unknown>
      )
    ).rejects.toThrow("Timeout must be a positive number.")
    await expect(
      Effect.runPromise(
        runtimeConfig.parseConfigValue("host", "   ") as Effect.Effect<never, unknown>
      )
    ).rejects.toThrow("Host cannot be empty.")
  })

  it("rejects missing questions and missing openai api keys", async () => {
    const runtimeConfig = await makeRuntimeConfig()

    await expect(
      Effect.runPromise(
        runtimeConfig.resolveRunConfig({
          question: [],
        })
      )
    ).rejects.toThrow("A question is required.")

    await expect(
      Effect.runPromise(
        runtimeConfig.resolveRunConfig({
          question: ["hi"],
          provider: "openai",
        })
      )
    ).rejects.toThrow("An API key is required for the openai provider.")
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
