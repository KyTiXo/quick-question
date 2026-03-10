import { describe, expect, it } from "bun:test"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { CliError } from "effect/unstable/cli"
import {
  buildProgram,
  handleDefect,
  handleError,
  isHandledError,
  runMain,
  runtimeOps,
} from "@/app/program"
import { handleConfig, handleRun } from "@/cli/handlers"
import { ConfigStoreError, DistillError, UsageError } from "@/schema/errors"
import { ConfigStore } from "@/services/config-store"
import { DistillEngine } from "@/services/distill-engine"
import { RuntimeConfig } from "@/services/runtime-config"

import { captureRuntime, getEffectError } from "./support"

const withLayers = <A, E, R, First, Rest extends ReadonlyArray<unknown>>(
  effect: Effect.Effect<A, E, R>,
  first: Layer.Layer<First>,
  ...rest: { [K in keyof Rest]: Layer.Layer<Rest[K]> }
) => effect.pipe(Effect.provide(Layer.mergeAll(first, ...rest) as never)) as Effect.Effect<A, E>

describe("cli handlers + program", () => {
  it("runs the distill handler with normalized cli options", async () => {
    let input: unknown
    let config: unknown

    const runtimeConfigLayer = Layer.succeed(RuntimeConfig)({
      defaults: () => Effect.die(new Error("unused")),
      getEffectiveConfig: () => Effect.die(new Error("unused")),
      parseConfigValue: () => Effect.die(new Error("unused")),
      resolveRunConfig: (value: unknown) => {
        input = value
        return Effect.succeed({
          question: "q",
          provider: "ollama",
          model: "model",
          host: "http://host",
          apiKey: "",
          timeoutMs: 1,
          maxTokens: 200,
          thinking: false,
        })
      },
    } satisfies typeof RuntimeConfig.Service)
    const distillEngineLayer = Layer.succeed(DistillEngine)({
      run: (value: unknown) => {
        config = value
        return Effect.succeed(undefined)
      },
    } satisfies typeof DistillEngine.Service)

    await Effect.runPromise(
      withLayers(
        handleRun({
          question: ["what", "changed?"],
          provider: Option.some("openai"),
          model: Option.none(),
          host: Option.some("http://host"),
          apiKey: Option.some("key"),
          timeoutMs: Option.none(),
          maxTokens: Option.some("200"),
          thinking: Option.some("true"),
        }),
        runtimeConfigLayer,
        distillEngineLayer
      )
    )

    expect(input).toEqual({
      question: ["what", "changed?"],
      provider: "openai",
      model: undefined,
      host: "http://host",
      apiKey: "key",
      timeoutMs: undefined,
      maxTokens: "200",
      thinking: "true",
    })
    expect(config).toEqual({
      question: "q",
      provider: "ollama",
      model: "model",
      host: "http://host",
      apiKey: "",
      timeoutMs: 1,
      maxTokens: 200,
      thinking: false,
    })
  })

  it("shows, gets, sets, and validates config output", async () => {
    const runtime = captureRuntime()
    const effectiveConfig = {
      provider: "ollama" as const,
      model: "qwen",
      host: "http://127.0.0.1:11434",
      apiKey: "",
      timeoutMs: 90_000,
      maxTokens: 200,
      thinking: false,
    }
    const configStoreLayer = Layer.succeed(ConfigStore)({
      resolvePath: () => Effect.succeed("/tmp/config.json"),
      read: () => Effect.succeed({}),
      showLines: () => Effect.die(new Error("unused")),
      get: () => Effect.succeed("qwen"),
      setProviderModel: () => Effect.void,
      set: () => Effect.void,
    } satisfies typeof ConfigStore.Service)
    const runtimeConfigLayer = Layer.succeed(RuntimeConfig)({
      defaults: () => Effect.die(new Error("unused")),
      getEffectiveConfig: () => Effect.succeed(effectiveConfig),
      parseConfigValue: (_key: string, raw: string) => Effect.succeed(raw.toUpperCase()),
      resolveRunConfig: () => Effect.die(new Error("unused")),
    } satisfies typeof RuntimeConfig.Service)

    await Effect.runPromise(
      withLayers(
        handleConfig({ key: Option.none(), value: [] }),
        runtime.layer,
        configStoreLayer,
        runtimeConfigLayer
      )
    )
    await Effect.runPromise(
      withLayers(
        handleConfig({ key: Option.some("model"), value: [] }),
        runtime.layer,
        configStoreLayer,
        runtimeConfigLayer
      )
    )
    await Effect.runPromise(
      withLayers(
        handleConfig({ key: Option.some("model"), value: ["qwen", "3"] }),
        runtime.layer,
        configStoreLayer,
        runtimeConfigLayer
      )
    )

    expect(runtime.stdout.chunks.join("")).toBe(
      `${[
        "path=/tmp/config.json",
        "provider=ollama",
        "model=qwen",
        "host=http://127.0.0.1:11434",
        "api-key=",
        "timeout-ms=90000",
        "max-tokens=200",
        "thinking=false",
        "qwen",
        "model=QWEN 3",
      ].join("\n")}\n`
    )

    const unknownConfigError = await getEffectError(
      withLayers(
        handleConfig({ key: Option.some("unknown"), value: [] }),
        runtime.layer,
        configStoreLayer,
        runtimeConfigLayer
      )
    )
    expect((unknownConfigError as Error).message).toBe("Unknown config key: unknown")

    const missingValueError = await getEffectError(
      withLayers(
        handleConfig({ key: Option.some("model"), value: ["   "] }),
        runtime.layer,
        configStoreLayer,
        runtimeConfigLayer
      )
    )
    expect((missingValueError as Error).message).toBe("Missing value for config key model.")
  })

  it("shows blank host and api-key for effective local config", async () => {
    const runtime = captureRuntime()
    const configStoreLayer = Layer.succeed(ConfigStore)({
      resolvePath: () => Effect.succeed("/tmp/config.json"),
      read: () => Effect.succeed({}),
      showLines: () => Effect.die(new Error("unused")),
      get: () => Effect.die(new Error("unused")),
      setProviderModel: () => Effect.void,
      set: () => Effect.void,
    } satisfies typeof ConfigStore.Service)
    const runtimeConfigLayer = Layer.succeed(RuntimeConfig)({
      defaults: () => Effect.die(new Error("unused")),
      getEffectiveConfig: () =>
        Effect.succeed({
          provider: "local" as const,
          model: "hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf",
          host: "",
          apiKey: "",
          timeoutMs: 90_000,
          maxTokens: 200,
          thinking: false,
        }),
      parseConfigValue: () => Effect.die(new Error("unused")),
      resolveRunConfig: () => Effect.die(new Error("unused")),
    } satisfies typeof RuntimeConfig.Service)

    await Effect.runPromise(
      withLayers(
        handleConfig({ key: Option.none(), value: [] }),
        runtime.layer,
        configStoreLayer,
        runtimeConfigLayer
      )
    )

    expect(runtime.stdout.chunks.join("")).toBe(
      `${[
        "path=/tmp/config.json",
        "provider=local",
        "model=hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf",
        "host=",
        "api-key=",
        "timeout-ms=90000",
        "max-tokens=200",
        "thinking=false",
      ].join("\n")}\n`
    )
  })

  it("tracks model writes per provider and snapshots before provider switches", async () => {
    const runtime = captureRuntime()
    const calls: Array<readonly [string, string, string]> = []
    const configStoreLayer = Layer.succeed(ConfigStore)({
      resolvePath: () => Effect.succeed("/tmp/config.json"),
      read: () => Effect.succeed({}),
      showLines: () => Effect.die(new Error("unused")),
      get: () => Effect.die(new Error("unused")),
      setProviderModel: (provider: string, model: string) => {
        calls.push(["setProviderModel", provider, model])
        return Effect.void
      },
      set: (key: string, value: string | number | boolean) => {
        calls.push(["set", key, String(value)])
        return Effect.void
      },
    } satisfies typeof ConfigStore.Service)
    const runtimeConfigLayer = Layer.succeed(RuntimeConfig)({
      defaults: () => Effect.die(new Error("unused")),
      getEffectiveConfig: () =>
        Effect.succeed({
          provider: "ollama" as const,
          model: "qwen3.5:2b",
          host: "http://127.0.0.1:11434",
          apiKey: "",
          timeoutMs: 90_000,
          maxTokens: 200,
          thinking: false,
        }),
      parseConfigValue: (key: string, raw: string) =>
        Effect.succeed(key === "provider" ? raw.toLowerCase() : raw),
      resolveRunConfig: () => Effect.die(new Error("unused")),
    } satisfies typeof RuntimeConfig.Service)

    await Effect.runPromise(
      withLayers(
        handleConfig({ key: Option.some("model"), value: ["hf:model.gguf"] }),
        runtime.layer,
        configStoreLayer,
        runtimeConfigLayer
      )
    )
    await Effect.runPromise(
      withLayers(
        handleConfig({ key: Option.some("provider"), value: ["local"] }),
        runtime.layer,
        configStoreLayer,
        runtimeConfigLayer
      )
    )

    expect(calls).toEqual([
      ["setProviderModel", "ollama", "hf:model.gguf"],
      ["setProviderModel", "ollama", "qwen3.5:2b"],
      ["set", "provider", "local"],
    ])
  })

  it("maps program errors to exit codes and stderr", async () => {
    const runtime = captureRuntime()

    await Effect.runPromise(
      handleError(new CliError.ShowHelp({ commandPath: [], errors: [] })).pipe(
        Effect.provide(runtime.layer)
      )
    )
    expect(runtime.getExitCode() ?? -1).toBe(0)

    await Effect.runPromise(
      handleError(
        new CliError.ShowHelp({
          commandPath: ["qq"],
          errors: [
            new CliError.UnrecognizedOption({
              option: "--bad",
              command: undefined,
              suggestions: [],
            }),
          ],
        })
      ).pipe(Effect.provide(runtime.layer))
    )
    expect(runtime.getExitCode() ?? -1).toBe(2)

    await Effect.runPromise(
      handleError(new UsageError({ detail: "usage", exitCode: 9 })).pipe(
        Effect.provide(runtime.layer)
      )
    )
    expect(runtime.getExitCode() ?? -1).toBe(9)

    await Effect.runPromise(
      handleError(new ConfigStoreError({ detail: "config failed" })).pipe(
        Effect.provide(runtime.layer)
      )
    )
    expect(runtime.getExitCode() ?? -1).toBe(1)

    await Effect.runPromise(
      handleError(
        new CliError.UnrecognizedOption({ option: "--bad", command: undefined, suggestions: [] })
      ).pipe(Effect.provide(runtime.layer))
    )
    expect(runtime.getExitCode() ?? -1).toBe(2)

    await Effect.runPromise(
      handleError(new DistillError({ detail: "distill failed" })).pipe(
        Effect.provide(runtime.layer)
      )
    )
    expect(runtime.getExitCode() ?? -1).toBe(1)

    await Effect.runPromise(
      handleError(new Error("boom") as unknown as UsageError).pipe(Effect.provide(runtime.layer))
    )
    expect(runtime.getExitCode() ?? -1).toBe(1)
    expect(runtime.stderr.chunks.join("")).toContain(
      "usage\nconfig failed\nUnrecognized flag: --bad\ndistill failed\nboom\n"
    )
  })

  it("handles defects with Cause.pretty to stderr", async () => {
    const runtime = captureRuntime()

    await Effect.runPromise(
      handleDefect(Cause.die(new Error("defect msg"))).pipe(Effect.provide(runtime.layer))
    )

    expect(runtime.getExitCode() ?? -1).toBe(1)
    expect(runtime.stderr.chunks.join("")).toContain("defect msg")
  })

  it("builds the top-level program", () => {
    expect(buildProgram()).toBeDefined()
    expect(isHandledError(new Error("boom"))).toBe(false)
  })

  it("delegates main execution to NodeRuntime", () => {
    const originalRunMain = runtimeOps.runMain
    runtimeOps.runMain = () => undefined as never

    try {
      expect(runMain()).toBeUndefined()
    } finally {
      runtimeOps.runMain = originalRunMain
    }
  })
})
