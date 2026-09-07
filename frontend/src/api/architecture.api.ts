import { http } from './http';
import type {
  Architecture,
  ArchitectureEditPayload,
  ArchitectureVersionSummary,
} from '../architecture/types';

export const architectureApi = {
  async generateArchitecture(projectId: string): Promise<Architecture> {
    const { data } = await http.post<Architecture>(`/projects/${projectId}/architecture/generate`);
    return data;
  },

  async regenerateArchitecture(projectId: string): Promise<Architecture> {
    const { data } = await http.post<Architecture>(
      `/projects/${projectId}/architecture/regenerate`,
    );
    return data;
  },

  async getArchitecture(projectId: string): Promise<Architecture> {
    const { data } = await http.get<Architecture>(`/projects/${projectId}/architecture`);
    return data;
  },

  async getArchitectureVersions(projectId: string): Promise<ArchitectureVersionSummary[]> {
    const { data } = await http.get<ArchitectureVersionSummary[]>(
      `/projects/${projectId}/architecture/versions`,
    );
    return data;
  },

  async getArchitectureVersion(projectId: string, version: number): Promise<Architecture> {
    const { data } = await http.get<Architecture>(
      `/projects/${projectId}/architecture/versions/${version}`,
    );
    return data;
  },

  async updateArchitecture(
    projectId: string,
    payload: ArchitectureEditPayload,
  ): Promise<Architecture> {
    const { data } = await http.patch<Architecture>(
      `/projects/${projectId}/architecture`,
      payload,
    );
    return data;
  },
};
