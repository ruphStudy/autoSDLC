import { http } from './http';
import type { ArchivedFilter, Project, ProjectFormPayload } from '../projects/types';

export const projectsApi = {
  async createProject(payload: ProjectFormPayload): Promise<Project> {
    const { data } = await http.post<Project>('/projects', payload);
    return data;
  },

  async updateProject(id: string, payload: Partial<ProjectFormPayload>): Promise<Project> {
    const { data } = await http.patch<Project>(`/projects/${id}`, payload);
    return data;
  },

  async getProjects(archived: ArchivedFilter = 'false'): Promise<Project[]> {
    const { data } = await http.get<Project[]>('/projects', { params: { archived } });
    return data;
  },

  async getProject(id: string): Promise<Project> {
    const { data } = await http.get<Project>(`/projects/${id}`);
    return data;
  },

  async archiveProject(id: string): Promise<Project> {
    const { data } = await http.post<Project>(`/projects/${id}/archive`);
    return data;
  },

  async restoreProject(id: string): Promise<Project> {
    const { data } = await http.post<Project>(`/projects/${id}/restore`);
    return data;
  },

  async deleteProject(id: string): Promise<void> {
    await http.delete(`/projects/${id}`);
  },
};
