import { http } from './http';
import type {
  ApprovalRecord,
  ApprovalStage,
  ApprovalStatus,
  ApprovalSummary,
  DecideApprovalPayload,
} from '../approval/types';

export const approvalApi = {
  async getHistory(projectId: string, stage?: ApprovalStage): Promise<ApprovalRecord[]> {
    const { data } = await http.get<ApprovalRecord[]>(`/projects/${projectId}/approvals`, {
      params: stage ? { stage } : undefined,
    });
    return data;
  },

  async getSummary(projectId: string): Promise<ApprovalSummary> {
    const { data } = await http.get<ApprovalSummary>(`/projects/${projectId}/approvals/summary`);
    return data;
  },

  async getStatus(projectId: string, stage: ApprovalStage): Promise<ApprovalStatus> {
    const { data } = await http.get<ApprovalStatus>(
      `/projects/${projectId}/approvals/${stage}`,
    );
    return data;
  },

  async decide(
    projectId: string,
    stage: ApprovalStage,
    payload: DecideApprovalPayload,
  ): Promise<ApprovalRecord> {
    const { data } = await http.post<ApprovalRecord>(
      `/projects/${projectId}/approvals/${stage}`,
      payload,
    );
    return data;
  },
};
