import { Schema } from "effect"
import { configKeys, providerValues } from "@/domain/config"

export const Provider = Schema.Literals(providerValues)
export type Provider = typeof Provider.Type

export const ConfigKey = Schema.Literals(configKeys)
export type ConfigKey = typeof ConfigKey.Type

export const PersistedConfig = Schema.Struct({
  provider: Schema.optional(Provider),
  model: Schema.optional(Schema.String),
  host: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Schema.Number),
  thinking: Schema.optional(Schema.Boolean),
})
export type PersistedConfig = Schema.Schema.Type<typeof PersistedConfig>

export const PersistedConfigJson = Schema.fromJsonString(PersistedConfig)
export const decodePersistedConfigJson = Schema.decodeUnknownEffect(PersistedConfigJson)
export const encodePersistedConfigJson = Schema.encodeEffect(PersistedConfigJson)

export const ResolvedRunConfig = Schema.Struct({
  question: Schema.String,
  provider: Provider,
  model: Schema.String,
  host: Schema.String,
  apiKey: Schema.String,
  timeoutMs: Schema.Number,
  thinking: Schema.Boolean,
})
export type ResolvedRunConfig = Schema.Schema.Type<typeof ResolvedRunConfig>

export const decodeConfigKey = Schema.decodeUnknownEffect(ConfigKey)
