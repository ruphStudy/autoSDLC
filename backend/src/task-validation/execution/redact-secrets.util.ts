// Best-effort redaction of obvious secrets from validation command output
// before persistence (item 68) — a test/build script can print a token or
// credential-bearing URL by accident. This is defense in depth, not a
// guarantee: it catches well-known, common patterns, not arbitrary secrets.
type Replacer = string | ((match: string) => string);

const PATTERNS: [RegExp, Replacer][] = [
  [/authorization:.*/gi, 'authorization: [REDACTED]'],
  [/bearer\s+[\w.\-]+/gi, 'Bearer [REDACTED]'],
  // Credentials embedded in a URL: https://user:pass@host -> https://[REDACTED]@host
  [/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@'],
  // Common vendor API key shapes (OpenAI/Anthropic-style, and a generic
  // "sk-"/"ghp_"/"AKIA" prefix family).
  [/\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, 'sk-ant-[REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{10,}\b/g, 'sk-[REDACTED]'],
  [/\bghp_[A-Za-z0-9]{10,}\b/g, 'ghp_[REDACTED]'],
  [/\bAKIA[A-Z0-9]{12,}\b/g, 'AKIA[REDACTED]'],
  [
    /\b(?:api[_-]?key|secret)["'\s:=]{1,5}[A-Za-z0-9_\-.]{16,}/gi,
    (match: string) => match.replace(/[A-Za-z0-9_\-.]{16,}$/, '[REDACTED]'),
  ],
];

export function redactSecrets(text: string): string {
  let sanitized = text;
  for (const [pattern, replacement] of PATTERNS) {
    sanitized =
      typeof replacement === 'string'
        ? sanitized.replace(pattern, replacement)
        : sanitized.replace(pattern, replacement);
  }
  return sanitized;
}
