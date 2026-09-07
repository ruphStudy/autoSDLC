import { AnalysisSource } from '@prisma/client';

export interface ArchitectureVersionSummary {
  id: string;
  version: number;
  source: AnalysisSource;
  basedOnVersion: number | null;
  projectAnalysisId: string;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  createdAt: Date;
}
