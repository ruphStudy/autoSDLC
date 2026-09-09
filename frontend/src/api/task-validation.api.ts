import { http } from './http';
import type { Job } from '../jobs/types';
import type { TaskValidationEligibility, ValidationAttempt } from '../task-validation/types';

export const taskValidationApi = {
  async validate(
    projectId: string,
    taskId: string,
  ): Promise<{ validationAttempt: ValidationAttempt; job: Job }> {
    const { data } = await http.post(`/projects/${projectId}/tasks/${taskId}/validate`);
    return data;
  },

  async getEligibility(projectId: string, taskId: string): Promise<TaskValidationEligibility> {
    const { data } = await http.get<TaskValidationEligibility>(
      `/projects/${projectId}/tasks/${taskId}/validation-eligibility`,
    );
    return data;
  },

  async listValidations(projectId: string, taskId: string): Promise<ValidationAttempt[]> {
    const { data } = await http.get<ValidationAttempt[]>(
      `/projects/${projectId}/tasks/${taskId}/validations`,
    );
    return data;
  },

  async getValidation(projectId: string, validationAttemptId: string): Promise<ValidationAttempt> {
    const { data } = await http.get<ValidationAttempt>(
      `/projects/${projectId}/validations/${validationAttemptId}`,
    );
    return data;
  },
};
