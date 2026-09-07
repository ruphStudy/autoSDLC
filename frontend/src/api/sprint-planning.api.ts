import { http } from './http';
import type {
  SprintPlan,
  SprintPlanEditPayload,
  SprintPlanVersionSummary,
} from '../sprint-planning/types';

export const sprintPlanningApi = {
  async generateSprintPlan(projectId: string): Promise<SprintPlan> {
    const { data } = await http.post<SprintPlan>(`/projects/${projectId}/sprint-plan/generate`);
    return data;
  },

  async regenerateSprintPlan(projectId: string): Promise<SprintPlan> {
    const { data } = await http.post<SprintPlan>(
      `/projects/${projectId}/sprint-plan/regenerate`,
    );
    return data;
  },

  async getSprintPlan(projectId: string): Promise<SprintPlan> {
    const { data } = await http.get<SprintPlan>(`/projects/${projectId}/sprint-plan`);
    return data;
  },

  async getSprintPlanVersions(projectId: string): Promise<SprintPlanVersionSummary[]> {
    const { data } = await http.get<SprintPlanVersionSummary[]>(
      `/projects/${projectId}/sprint-plan/versions`,
    );
    return data;
  },

  async getSprintPlanVersion(projectId: string, version: number): Promise<SprintPlan> {
    const { data } = await http.get<SprintPlan>(
      `/projects/${projectId}/sprint-plan/versions/${version}`,
    );
    return data;
  },

  async updateSprintPlan(
    projectId: string,
    payload: SprintPlanEditPayload,
  ): Promise<SprintPlan> {
    const { data } = await http.patch<SprintPlan>(
      `/projects/${projectId}/sprint-plan`,
      payload,
    );
    return data;
  },
};
