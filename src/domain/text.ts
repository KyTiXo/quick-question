// biome-ignore lint/complexity/useRegexLiterals: constructor avoids eslint no-control-regex
const ANSI_PATTERN = new RegExp(String.raw`\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])`, "g")

const PROMPT_PATTERN =
  /(?:\[[Yy]\/[Nn]\]|\[[Nn]\/[Yy]\]|\([Yy]\/[Nn]\)|\([Nn]\/[Yy]\)|password:|passphrase:|continue\?|proceed\?)\s*$/i

export const normalizeForModel = (input: string) =>
  input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(ANSI_PATTERN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

export const hasPromptLikeTail = (input: string) => PROMPT_PATTERN.test(input.slice(-256).trimEnd())

export const hasRedrawSignal = (input: string) =>
  input.includes("\r") || input.includes("\u001b[2J") || input.includes("\u001bc")

const structuralSignature = (input: string) =>
  normalizeForModel(input)
    .split("\n")
    .map((line) =>
      line
        .toLowerCase()
        .replace(/\b\d+\b/g, "#")
        .replace(/[0-9a-f]{7,}/g, "<hex>")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .slice(0, 24)

export const structuralSimilarity = (left: string, right: string) => {
  const a = structuralSignature(left)
  const b = structuralSignature(right)

  if (a.length === 0 || b.length === 0) {
    return 0
  }

  const leftSet = new Set(a)
  const rightSet = new Set(b)
  let overlap = 0

  for (const value of leftSet) {
    if (rightSet.has(value)) {
      overlap += 1
    }
  }

  return (2 * overlap) / (leftSet.size + rightSet.size)
}

export const looksLikeBadDistillation = (source: string, candidate: string) => {
  const normalizedSource = normalizeForModel(source)
  const normalizedCandidate = normalizeForModel(candidate)

  if (!normalizedCandidate) {
    return true
  }

  const lowerCandidate = normalizedCandidate.toLowerCase()

  if (
    lowerCandidate.includes("please provide") ||
    lowerCandidate.includes("wish summarized") ||
    lowerCandidate.includes("provided command output")
  ) {
    return true
  }

  if (normalizedSource.length >= 1024) {
    return normalizedCandidate.length >= normalizedSource.length * 0.8
  }

  if (normalizedSource.length > 0)
    return (
      normalizedCandidate === normalizedSource ||
      normalizedCandidate.length > normalizedSource.length + 40
    )

  return false
}

export const ensureTrailingNewline = (text: string) => (text.endsWith("\n") ? text : `${text}\n`)
