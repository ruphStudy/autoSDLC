import { http } from './http';
import type { Job } from '../jobs/types';
import type {
  RepositoryReadiness,
  Workspace,
  WorkspaceDiffResult,
  WorkspaceStatusResult,
} from '../workspace/types';

export const workspaceApi = {
  async get(projectId: string): Promise<Workspace> {
    const { data } = await http.get<Workspace>(`/projects/${projectId}/workspace`);
    return data;
  },

  async prepare(projectId: string): Promise<{ workspace: Workspace; job: Job }> {
    const { data } = await http.post<{ workspace: Workspace; job: Job }>(
      `/projects/${projectId}/workspace/prepare`,
    );
    return data;
  },

  async validate(projectId: string): Promise<RepositoryReadiness> {
    const { data } = await http.post<RepositoryReadiness>(
      `/projects/${projectId}/workspace/validate`,
    );
    return data;
  },

  async getStatus(projectId: string): Promise<WorkspaceStatusResult> {
    const { data } = await http.get<WorkspaceStatusResult>(
      `/projects/${projectId}/workspace/status`,
    );
    return data;
  },

  async getDiff(projectId: string, staged = false): Promise<WorkspaceDiffResult> {
    const { data } = await http.get<WorkspaceDiffResult>(
      `/projects/${projectId}/workspace/diff`,
      { params: staged ? { staged: true } : undefined },
    );
    return data;
  },

  async cleanup(projectId: string): Promise<Workspace> {
    const { data } = await http.delete<Workspace>(`/projects/${projectId}/workspace`);
    return data;
  },
};
