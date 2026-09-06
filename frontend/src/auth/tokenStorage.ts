// Centralized token persistence. MVP trade-off: tokens live in localStorage,
// which is simple but readable by any script on the page (XSS exposure). All
// reads/writes go through this module so the storage mechanism (e.g. moving
// to httpOnly cookies set by the backend) can change without touching the
// rest of the app.

const ACCESS_TOKEN_KEY = 'autosdlc.accessToken';
const REFRESH_TOKEN_KEY = 'autosdlc.refreshToken';

export const tokenStorage = {
  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  },
  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  },
  setAccessToken(accessToken: string): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};
