import { http } from './http';
import type { Job } from '../jobs/types';
import type { TaskEligibility, TaskExecution } from '../task-execution/types';

export const taskExecutionApi = {
  async run(
    projectId: string,
    taskId: string,
  ): Promise<{ taskExecution: TaskExecution; job: Job; task: { id: string; status: string } }> {
    const { data } = await http.post(`/projects/${projectId}/tasks/${taskId}/run`);
    return data;
  },

  async getEligibility(projectId: string, taskId: string): Promise<TaskEligibility> {
    const { data } = await http.get<TaskEligibility>(
      `/projects/${projectId}/tasks/${taskId}/execution-eligibility`,
    );
    return data;
  },

  async listExecutions(projectId: string, taskId: string): Promise<TaskExecution[]> {
    const { data } = await http.get<TaskExecution[]>(
      `/projects/${projectId}/tasks/${taskId}/executions`,
    );
    return data;
  },

  async getCurrentExecution(projectId: string, taskId: string): Promise<TaskExecution> {
    const { data } = await http.get<TaskExecution>(
      `/projects/${projectId}/tasks/${taskId}/execution/current`,
    );
    return data;
  },

  async getExecution(projectId: string, executionId: string): Promise<TaskExecution> {
    const { data } = await http.get<TaskExecution>(
      `/projects/${projectId}/task-executions/${executionId}`,
    );
    return data;
  },
};
