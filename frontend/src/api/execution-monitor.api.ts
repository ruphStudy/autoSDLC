import { http } from './http';
import type {
  ExecutionHistoryEntry,
  ProjectExecutionOverview,
  TimelinePage,
} from '../execution-monitor/types';

export const executionMonitorApi = {
  async getOverview(projectId: string): Promise<ProjectExecutionOverview> {
    const { data } = await http.get<ProjectExecutionOverview>(
      `/projects/${projectId}/execution-monitor`,
    );
    return data;
  },

  async getHistory(
    projectId: string,
    params: { limit?: number; cursor?: string } = {},
  ): Promise<{ executions: ExecutionHistoryEntry[]; nextCursor: string | null }> {
    const { data } = await http.get<{
      executions: ExecutionHistoryEntry[];
      nextCursor: string | null;
    }>(`/projects/${projectId}/execution-history`, { params });
    return data;
  },

  async getTimeline(
    projectId: string,
    params: { limit?: number; cursor?: string } = {},
  ): Promise<TimelinePage> {
    const { data } = await http.get<TimelinePage>(
      `/projects/${projectId}/execution-timeline`,
      { params },
    );
    return data;
  },
};
