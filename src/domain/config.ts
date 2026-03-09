export const DEFAULT_PROVIDER: (typeof providerValues)[number] = "ollama"
export const DEFAULT_MODEL = "qwen3.5:2b"
export const DEFAULT_HOST = "http://127.0.0.1:11434"
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
export const DEFAULT_TIMEOUT_MS = 90_000
export const DEFAULT_IDLE_MS = 1_200
export const DEFAULT_INTERACTIVE_GAP_MS = 180
export const DEFAULT_PROGRESS_FRAME_MS = 120

export const configKeys = [
  "provider",
  "model",
  "host",
  "api-key",
  "timeout-ms",
  "thinking",
] as const

export const providerValues = ["ollama", "openai"] as const

export const configFieldByKey = {
  provider: "provider",
  model: "model",
  host: "host",
  "api-key": "apiKey",
  "timeout-ms": "timeoutMs",
  thinking: "thinking",
} as const

export const envKeys = {
  provider: "QQ_PROVIDER",
  model: "QQ_MODEL",
  host: "QQ_HOST",
  timeoutMs: "QQ_TIMEOUT_MS",
  thinking: "QQ_THINKING",
  progressProtocol: "QQ_PROGRESS_PROTOCOL",
  configPath: "QQ_CONFIG_PATH",
  ollamaHost: "OLLAMA_HOST",
  openAiBaseUrl: "OPENAI_BASE_URL",
  openAiApiKey: "OPENAI_API_KEY",
} as const

export const truthyValues = new Set(["true", "1", "yes", "on"])
export const falsyValues = new Set(["false", "0", "no", "off"])

export const joinQuestion = (parts: ReadonlyArray<string>) => parts.join(" ").trim()

export const maskSecret = (value: string) => (value ? "***" : "")

export const trimToUndefined = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export const normalizeHost = (value: string) => value.trim().replace(/\/+$/, "")

export const defaultHostFor = (provider: (typeof providerValues)[number]) =>
  provider === "openai" ? DEFAULT_OPENAI_BASE_URL : DEFAULT_HOST
