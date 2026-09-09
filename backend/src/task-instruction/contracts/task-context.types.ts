import { TaskStatus } from '@prisma/client';
import { CommitSummary } from '../../workspace/git/git.types';
import { RepositoryFileContent } from '../repository/repository-tree.service';

export interface DependencyTaskContext {
  taskKey: string;
  title: string;
  status: TaskStatus;
  // Only present once Sprint 12 has actually executed the dependency and it
  // produced an AgentJob — never fabricated when absent (item 23).
  lastAttempt?: {
    status: string;
    summary: string | null;
  };
}

export interface RelevantRequirement {
  id: string;
  title: string;
  description: string;
}

export interface RelevantArchitectureArea {
  area: string;
  content: unknown;
}

export interface RelevantAdr {
  id: string;
  title: string;
  decision: string;
  rationale?: string;
}

export interface TaskContext {
  project: {
    id: string;
    name: string;
    brief: string;
    repositoryType: 'NEW' | 'EXISTING';
  };

  projectAnalysis: {
    id: string;
    version: number;
    summary: string;
  };

  architecture: {
    id: string;
    version: number;
    summary: string;
    relevantAreas: RelevantArchitectureArea[];
    relevantAdrs: RelevantAdr[];
  };

  sprintPlan: {
    id: string;
    version: number;
    summary: string;
    strategy: string;
  };

  sprint: {
    id: string;
    number: number;
    title: string;
    objective: string;
  };

  task: {
    id: string;
    key: string;
    title: string;
    description: string;
    acceptanceCriteria: string[];
    validationExpectations: Array<{
      type: string;
      description: string;
      required: boolean;
    }>;
    requirementIds: string[];
    architectureAreas: string[];
    relevantRequirements: RelevantRequirement[];
  };

  dependencies: DependencyTaskContext[];

  repository: {
    branch: string | null;
    headCommitSha: string | null;
    clean: boolean;
    tree: { entries: string[]; truncated: boolean };
    manifests: RepositoryFileContent[];
    manifestsSkipped: string[];
    manifestsTruncated: boolean;
    recentCommits: CommitSummary[];
  };
}
