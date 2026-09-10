import { http } from './http';
import type {
  SprintAcceptanceEligibility,
  SprintAcceptanceRecord,
} from '../sprint-acceptance/types';
import type { Job } from '../jobs/types';

export const sprintAcceptanceApi = {
  async getEligibility(
    projectId: string,
    sprintId: string,
  ): Promise<SprintAcceptanceEligibility> {
    const { data } = await http.get<SprintAcceptanceEligibility>(
      `/projects/${projectId}/sprints/${sprintId}/acceptance-eligibility`,
    );
    return data;
  },

  async generate(
    projectId: string,
    sprintId: string,
  ): Promise<{ sprintAcceptance: SprintAcceptanceRecord; job: Job }> {
    const { data } = await http.post<{ sprintAcceptance: SprintAcceptanceRecord; job: Job }>(
      `/projects/${projectId}/sprints/${sprintId}/acceptance/generate`,
    );
    return data;
  },

  async regenerate(
    projectId: string,
    sprintId: string,
  ): Promise<{ sprintAcceptance: SprintAcceptanceRecord; job: Job }> {
    const { data } = await http.post<{ sprintAcceptance: SprintAcceptanceRecord; job: Job }>(
      `/projects/${projectId}/sprints/${sprintId}/acceptance/regenerate`,
    );
    return data;
  },

  async getCurrent(projectId: string, sprintId: string): Promise<SprintAcceptanceRecord> {
    const { data } = await http.get<SprintAcceptanceRecord>(
      `/projects/${projectId}/sprints/${sprintId}/acceptance`,
    );
    return data;
  },

  async getHistory(projectId: string, sprintId: string): Promise<SprintAcceptanceRecord[]> {
    const { data } = await http.get<SprintAcceptanceRecord[]>(
      `/projects/${projectId}/sprints/${sprintId}/acceptance/versions`,
    );
    return data;
  },

  async getVersion(
    projectId: string,
    sprintId: string,
    version: number,
  ): Promise<SprintAcceptanceRecord> {
    const { data } = await http.get<SprintAcceptanceRecord>(
      `/projects/${projectId}/sprints/${sprintId}/acceptance/versions/${version}`,
    );
    return data;
  },

  async accept(
    projectId: string,
    sprintId: string,
    notes?: string,
  ): Promise<SprintAcceptanceRecord> {
    const { data } = await http.post<SprintAcceptanceRecord>(
      `/projects/${projectId}/sprints/${sprintId}/acceptance/accept`,
      notes ? { notes } : {},
    );
    return data;
  },

  async reject(
    projectId: string,
    sprintId: string,
    reason: string,
  ): Promise<SprintAcceptanceRecord> {
    const { data } = await http.post<SprintAcceptanceRecord>(
      `/projects/${projectId}/sprints/${sprintId}/acceptance/reject`,
      { reason },
    );
    return data;
  },
};
