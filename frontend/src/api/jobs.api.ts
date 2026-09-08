import { http } from './http';
import type { Job, JobEvent, JobStatus, JobType } from '../jobs/types';

export const jobsApi = {
  async enqueue(projectId: string, type: JobType): Promise<Job> {
    const { data } = await http.post<Job>(`/projects/${projectId}/jobs`, { type });
    return data;
  },

  async list(
    projectId: string,
    filters: { status?: JobStatus; type?: JobType; limit?: number } = {},
  ): Promise<Job[]> {
    const { data } = await http.get<Job[]>(`/projects/${projectId}/jobs`, {
      params: filters,
    });
    return data;
  },

  async getById(projectId: string, jobId: string): Promise<Job> {
    const { data } = await http.get<Job>(`/projects/${projectId}/jobs/${jobId}`);
    return data;
  },

  async getEvents(projectId: string, jobId: string): Promise<JobEvent[]> {
    const { data } = await http.get<JobEvent[]>(`/projects/${projectId}/jobs/${jobId}/events`);
    return data;
  },

  async cancel(projectId: string, jobId: string): Promise<Job> {
    const { data } = await http.post<Job>(`/projects/${projectId}/jobs/${jobId}/cancel`);
    return data;
  },
};
