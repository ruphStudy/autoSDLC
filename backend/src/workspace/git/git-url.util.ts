// Strips embedded credentials (https://user:pass@host/... or
// https://token@host/...) before a remote URL is ever logged, persisted, or
// returned in an API response. SSH scp-like syntax (git@host:path) has no
// embedded secret to strip — the "git" there is a fixed SSH username, not a
// credential — so it passes through unchanged.
export function redactGitUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
    }
    return parsed.toString();
  } catch {
    return url.replace(/^(\w+:\/\/)[^@/]*@/, '$1');
  }
}

const SCP_LIKE_SSH_URL = /^[\w.-]+@[\w.-]+:[\w./-]+(?:\.git)?$/;

// Whitelist, not blacklist: only protocols we actually support and have
// reasoned about are allowed. Rejects file://, ext::, and any other local
// or helper transport that could be used to read/execute something outside
// a plain network clone.
export function isSupportedRepositoryUrl(url: string): boolean {
  if (SCP_LIKE_SSH_URL.test(url)) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'ssh:';
  } catch {
    return false;
  }
}
