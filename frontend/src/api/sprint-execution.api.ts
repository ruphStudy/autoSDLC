import { http } from './http';
import type { Job } from '../jobs/types';
import type { SprintExecution, SprintExecutionEligibility } from '../sprint-execution/types';

export const sprintExecutionApi = {
  async run(projectId: string, sprintId: string): Promise<{ sprintExecution: SprintExecution; job: Job }> {
    const { data } = await http.post(`/projects/${projectId}/sprints/${sprintId}/run`);
    return data;
  },

  async pause(projectId: string, sprintId: string): Promise<SprintExecution> {
    const { data } = await http.post<SprintExecution>(
      `/projects/${projectId}/sprints/${sprintId}/pause`,
    );
    return data;
  },

  async resume(
    projectId: string,
    sprintId: string,
  ): Promise<{ sprintExecution: SprintExecution; job: Job }> {
    const { data } = await http.post(`/projects/${projectId}/sprints/${sprintId}/resume`);
    return data;
  },

  async getEligibility(projectId: string, sprintId: string): Promise<SprintExecutionEligibility> {
    const { data } = await http.get<SprintExecutionEligibility>(
      `/projects/${projectId}/sprints/${sprintId}/execution-eligibility`,
    );
    return data;
  },

  async getCurrentExecution(projectId: string, sprintId: string): Promise<SprintExecution> {
    const { data } = await http.get<SprintExecution>(
      `/projects/${projectId}/sprints/${sprintId}/execution`,
    );
    return data;
  },
};
