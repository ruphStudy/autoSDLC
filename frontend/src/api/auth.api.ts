import { http } from './http';
import type {
  AuthResponse,
  LoginPayload,
  RegisterPayload,
  User,
} from '../auth/types';

export const authApi = {
  async register(payload: RegisterPayload): Promise<AuthResponse> {
    const { data } = await http.post<AuthResponse>('/auth/register', payload);
    return data;
  },

  async login(payload: LoginPayload): Promise<AuthResponse> {
    const { data } = await http.post<AuthResponse>('/auth/login', payload);
    return data;
  },

  async me(): Promise<User> {
    const { data } = await http.get<User>('/auth/me');
    return data;
  },

  async logout(): Promise<void> {
    await http.post('/auth/logout');
  },
};
