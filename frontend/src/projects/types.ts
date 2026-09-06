export type ProjectStatus =
  | 'DRAFT'
  | 'ANALYZING'
  | 'ANALYSIS_READY'
  | 'PLANNING'
  | 'PLAN_READY'
  | 'AWAITING_APPROVAL'
  | 'DEVELOPING'
  | 'TESTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'PAUSED';

export type RepositoryType = 'NEW' | 'EXISTING';

export interface Project {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  brief: string;
  preferredStack: string | null;
  repositoryType: RepositoryType;
  repositoryUrl: string | null;
  status: ProjectStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFormPayload {
  name: string;
  brief: string;
  description?: string;
  preferredStack?: string;
  repositoryType?: RepositoryType;
  repositoryUrl?: string;
}

export type ArchivedFilter = 'false' | 'true' | 'all';
