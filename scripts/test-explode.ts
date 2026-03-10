import { spawnSync } from "node:child_process"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const cli = path.join(root, "src", "app", "main.ts")

const diff = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,4 +1,7 @@",
  " const country = user.country",
  "+const isInUSA = country === 'US'",
  " const hidden = false",
  "+const locale = user.locale ?? 'en-US'",
  "+const shouldHideKlarna = hidden && isInUSA",
  "+render({ shouldHideKlarna, locale })",
].join("\n")

const testOutput = [
  "bun test v1.3.6",
  "(pass) auth > accepts valid token",
  "(fail) checkout > hides klarna for US guests",
  "Expected: true",
  "Received: false",
  "(pass) ui > renders cart",
].join("\n")

const logs = [
  "2026-03-10T10:00:00Z INFO starting sync",
  "2026-03-10T10:00:01Z INFO fetching customer 42",
  "2026-03-10T10:00:02Z ERROR request failed status=429 provider=ollama",
  "2026-03-10T10:00:03Z WARN retry budget exhausted",
].join("\n")

interface Scenario {
  name: string
  question: string
  input: string
  expect: "success" | "failure"
  env?: Record<string, string>
  stderrIncludes?: string
}

const cases: Array<Scenario> = [
  {
    name: "diff summary",
    question: "what changed?",
    input: diff,
    expect: "success",
  },
  {
    name: "test summary",
    question: "did the tests pass?",
    input: testOutput,
    expect: "success",
  },
  {
    name: "log diagnosis",
    question: "what is the root cause?",
    input: logs,
    expect: "success",
  },
  {
    name: "expected provider failure",
    question: "what changed?",
    input: diff,
    expect: "failure",
    env: {
      QQ_PROVIDER: "openai",
      OPENAI_API_KEY: "",
    },
    stderrIncludes: "An API key is required for the openai provider.",
  },
]

const runCase = (scenario: Scenario) => {
  const result = spawnSync("bun", ["run", cli, scenario.question], {
    cwd: root,
    encoding: "utf8",
    input: scenario.input,
    env: {
      ...process.env,
      QQ_TIMEOUT_MS: "90000",
      ...scenario.env,
    },
  })

  const stdout = result.stdout.trim()
  const stderr = result.stderr.trim()

  if (scenario.expect === "success") {
    if (result.status !== 0) {
      return {
        ok: false,
        detail: stderr || `expected success, got status ${String(result.status)}`,
      }
    }

    if (stdout.length === 0) {
      return {
        ok: false,
        detail: "expected non-empty stdout",
      }
    }

    if (stdout.length >= scenario.input.length) {
      return {
        ok: false,
        detail: "expected compressed output shorter than input",
      }
    }

    return {
      ok: true,
      detail: stdout,
    }
  }

  if (result.status === 0) {
    return {
      ok: false,
      detail: "expected failure, got success",
    }
  }

  if (scenario.stderrIncludes && !stderr.includes(scenario.stderrIncludes)) {
    return {
      ok: false,
      detail: `stderr missing expected text: ${scenario.stderrIncludes}`,
    }
  }

  return {
    ok: true,
    detail: stderr || `failed as expected with status ${String(result.status)}`,
  }
}

const results = cases.map((scenario) => ({
  name: scenario.name,
  expect: scenario.expect,
  ...runCase(scenario),
}))

for (const result of results) {
  const label = result.ok ? "PASS" : "FAIL"
  const expectation = result.expect === "failure" ? "expected fail" : "expected pass"
  console.log(`${label}  ${result.name} (${expectation})`)
  console.log(`      ${result.detail}`)
}

const failed = results.filter((result) => !result.ok)

if (failed.length > 0) {
  throw new Error(`test:explode had ${String(failed.length)} unexpected result(s)`)
}
