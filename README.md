# Quick Question (qq)

Command output is one of the biggest sources of token waste in AI-assisted workflows.

Logs, test results, stack traces, diffs — thousands of tokens fed to an LLM just to answer a simple question.

**`qq` compresses command output into only what your LLM actually needs.**

Save **up to 99% of tokens** without losing the signal.

```bash
bun test 2>&1 | qq "did the tests pass?"
# → "3 tests failed: auth.test.ts lines 42, 78, 91"
```

Instead of dumping 2,000 lines of test output into your agent, you get 12 words.

`qq` is built around [Qwen 3.5](https://qwenlm.github.io/blog/qwen3/) — a model so good at compression and summarization that the **2b variant runs on almost any computer**. No GPU required, no cloud account, no API key. If your machine can run a browser, it can run `qq`.

## Install

```bash
ollama pull qwen3.5:2b   # make sure ollama serve is running
npm install -g quick-question
```

## Help

```
DESCRIPTION
  Compress command output before handing it to another LLM.

USAGE
  qq <subcommand> [flags] <question...>

ARGUMENTS
  question... string    Question to ask about stdin

FLAGS
  --provider string      LLM provider: ollama or openai
  --model string         Model name
  --host string          API base URL
  --api-key string       API key for openai provider
  --timeout-ms string    Request timeout in milliseconds
  --thinking string      Enable or disable model thinking

GLOBAL FLAGS
  --help, -h              Show help information
  --version               Show version information
  --completions choice    Print shell completion script
  --log-level choice      Sets the minimum log level

SUBCOMMANDS
  config    Show, get, or set persisted qq config.

EXAMPLES
  git diff | qq "what changed?"
  bun test 2>&1 | qq "did the tests pass?"
  qq config model "qwen3.5:2b"
```

## Providers

Ollama is the default (local, free). Switch to OpenAI or any OpenAI-compatible API (Groq, LM Studio, etc.) without touching config:

```bash
git log --oneline -50 | qq --provider openai --model gpt-4o-mini --api-key sk-... "summarize recent work"
```

Or persist a provider:

```bash
qq config provider openai
qq config api-key "sk-..."
qq config model "gpt-4o-mini"
```

## Token reduction

`qq` is purpose-built for compression. A typical `rg` across a large codebase, a full `git log`, or a verbose test run can easily hit tens of thousands of tokens. After `qq`, you get a tight, signal-only summary:

```bash
rg -n "auth|session|token" src/ | qq "where is authentication handled?"
```

| | Tokens | Characters |
|---|---|---|
| **Before** | ~6,400 | ~25,600 |
| **After** | ~80 | ~320 |
| **Saved** | **~99%** | **~99%** |

The numbers vary by input, but the pattern is consistent: noisy command output compresses aggressively. Short, targeted questions compress even more.

## Global agent instructions

Add this to your Codex, Claude Code, OpenCode, or Cursor agent instructions:

```
When running shell commands whose output may be long (tests, builds, diffs, logs), pipe
the output through `qq` with a short question rather than capturing the raw output.
Examples:
  bun test 2>&1 | qq "did the tests pass?"
  git diff HEAD~1 | qq "summarize the changes"
  terraform plan 2>&1 | qq "is this safe to apply?"
This reduces token usage and keeps context focused.
```

## Behavior notes

- **Watch mode** — repeating `watch`/`tail -f` output: only the delta is summarized, not the full dump every cycle.
- **Interactive passthrough** — `[Y/N]`, `Password:` prompts are forwarded raw, no LLM involvement.
- **Bad-summary fallback** — if the model response is longer than the input or is a refusal, the original input passes through unchanged.
- **Machine-readable progress** — set `QQ_PROGRESS_PROTOCOL=stderr` for structured markers (useful in CI or agent harnesses).
