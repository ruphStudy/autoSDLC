import { http } from './http';
import type {
  CompleteProjectResult,
  ProjectCompletionEligibility,
  ProjectDeliveryRecord,
} from '../project-delivery/types';

export const projectDeliveryApi = {
  async getEligibility(projectId: string): Promise<ProjectCompletionEligibility> {
    const { data } = await http.get<ProjectCompletionEligibility>(
      `/projects/${projectId}/completion-eligibility`,
    );
    return data;
  },

  async complete(projectId: string): Promise<CompleteProjectResult> {
    const { data } = await http.post<CompleteProjectResult>(
      `/projects/${projectId}/complete`,
    );
    return data;
  },

  async getCurrent(projectId: string): Promise<ProjectDeliveryRecord> {
    const { data } = await http.get<ProjectDeliveryRecord>(
      `/projects/${projectId}/delivery`,
    );
    return data;
  },
};
