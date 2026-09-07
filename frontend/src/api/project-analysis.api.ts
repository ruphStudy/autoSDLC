import { http } from './http';
import type {
  AnalysisVersionSummary,
  ProjectAnalysis,
  ProjectAnalysisEditPayload,
} from '../project-analysis/types';

export const projectAnalysisApi = {
  async generateProjectAnalysis(projectId: string): Promise<ProjectAnalysis> {
    const { data } = await http.post<ProjectAnalysis>(`/projects/${projectId}/analysis/generate`);
    return data;
  },

  async regenerateProjectAnalysis(projectId: string): Promise<ProjectAnalysis> {
    const { data } = await http.post<ProjectAnalysis>(
      `/projects/${projectId}/analysis/regenerate`,
    );
    return data;
  },

  async getProjectAnalysis(projectId: string): Promise<ProjectAnalysis> {
    const { data } = await http.get<ProjectAnalysis>(`/projects/${projectId}/analysis`);
    return data;
  },

  async getProjectAnalysisVersions(projectId: string): Promise<AnalysisVersionSummary[]> {
    const { data } = await http.get<AnalysisVersionSummary[]>(
      `/projects/${projectId}/analysis/versions`,
    );
    return data;
  },

  async getProjectAnalysisVersion(projectId: string, version: number): Promise<ProjectAnalysis> {
    const { data } = await http.get<ProjectAnalysis>(
      `/projects/${projectId}/analysis/versions/${version}`,
    );
    return data;
  },

  async updateProjectAnalysis(
    projectId: string,
    payload: ProjectAnalysisEditPayload,
  ): Promise<ProjectAnalysis> {
    const { data } = await http.patch<ProjectAnalysis>(`/projects/${projectId}/analysis`, payload);
    return data;
  },
};
