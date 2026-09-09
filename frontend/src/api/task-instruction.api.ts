import { http } from './http';
import type { TaskInstruction } from '../task-instruction/types';

export const taskInstructionApi = {
  async generate(projectId: string, taskId: string): Promise<TaskInstruction> {
    const { data } = await http.post<TaskInstruction>(
      `/projects/${projectId}/tasks/${taskId}/instruction/generate`,
    );
    return data;
  },

  async getCurrent(projectId: string, taskId: string): Promise<TaskInstruction> {
    const { data } = await http.get<TaskInstruction>(
      `/projects/${projectId}/tasks/${taskId}/instruction`,
    );
    return data;
  },

  async getHistory(projectId: string, taskId: string): Promise<TaskInstruction[]> {
    const { data } = await http.get<TaskInstruction[]>(
      `/projects/${projectId}/tasks/${taskId}/instruction/versions`,
    );
    return data;
  },
};
