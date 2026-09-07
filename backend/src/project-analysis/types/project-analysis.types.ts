import { AnalysisSource } from '@prisma/client';

export interface ProjectAnalysisVersionSummary {
  id: string;
  version: number;
  source: AnalysisSource;
  basedOnVersion: number | null;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  createdAt: Date;
}
