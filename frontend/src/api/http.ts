import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { tokenStorage } from '../auth/tokenStorage';
import type { AuthResponse } from '../auth/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export const http = axios.create({ baseURL: API_BASE_URL });

// Plain client (no interceptors) used to call /auth/refresh itself, so a
// failed refresh never recurses back into the refresh logic below.
const refreshClient = axios.create({ baseURL: API_BASE_URL });

// Called by AuthContext once, so the interceptor can clear React auth state
// when a refresh attempt ultimately fails (expired/revoked refresh token).
let onAuthFailure: (() => void) | null = null;
export function registerAuthFailureHandler(handler: () => void) {
  onAuthFailure = handler;
}

http.interceptors.request.use((config) => {
  const accessToken = tokenStorage.getAccessToken();
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

// Ensures concurrent 401s trigger a single refresh call, not one per request.
let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = tokenStorage.getRefreshToken();
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }
      const { data } = await refreshClient.post<AuthResponse>('/auth/refresh', {
        refreshToken,
      });
      tokenStorage.setTokens(data.accessToken, data.refreshToken);
      return data.accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableConfig | undefined;
    const isAuthEndpoint = originalRequest?.url?.includes('/auth/');

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retried ||
      isAuthEndpoint
    ) {
      return Promise.reject(error);
    }

    originalRequest._retried = true;

    try {
      const accessToken = await refreshAccessToken();
      originalRequest.headers.set('Authorization', `Bearer ${accessToken}`);
      return http(originalRequest);
    } catch (refreshError) {
      tokenStorage.clear();
      onAuthFailure?.();
      return Promise.reject(refreshError);
    }
  },
);
