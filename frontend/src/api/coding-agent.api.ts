import { http } from './http';
import type { Job } from '../jobs/types';
import type { AgentJob, CodingAgentHealth } from '../coding-agent/types';

export const codingAgentApi = {
  async health(): Promise<CodingAgentHealth> {
    const { data } = await http.get<CodingAgentHealth>('/internal/ai/coding/health');
    return data;
  },

  async runDiagnostic(projectId: string): Promise<{ agentJob: AgentJob; job: Job }> {
    const { data } = await http.post<{ agentJob: AgentJob; job: Job }>(
      `/projects/${projectId}/coding-agent/diagnostic`,
    );
    return data;
  },

  async list(projectId: string, limit = 20): Promise<AgentJob[]> {
    const { data } = await http.get<AgentJob[]>(`/projects/${projectId}/agent-jobs`, {
      params: { limit },
    });
    return data;
  },

  async getById(projectId: string, agentJobId: string): Promise<AgentJob> {
    const { data } = await http.get<AgentJob>(`/projects/${projectId}/agent-jobs/${agentJobId}`);
    return data;
  },
};
