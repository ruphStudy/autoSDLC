import { IsArray, IsString } from 'class-validator';

// Unlike ProjectAnalysis/Architecture edits (partial patch merged with the
// current version), a SprintPlan edit is a full structured replacement:
// the whole {summary, strategy, sprints[]} graph is validated and versioned
// atomically (spec's own recommendation — a nested dependency graph is
// safer to replace wholesale than to patch piecemeal). This DTO only
// whitelists the three top-level keys a client may send at all (blocking
// mass-assignment of projectId/architectureId/version/source/provider/
// model/token counts/timestamps/statuses, none of which are declared
// here); the actual deep validation is the same canonical
// SprintPlanContentSchema (zod) used for AI output, applied in the service.
export class EditSprintPlanDto {
  @IsString()
  summary!: string;

  @IsString()
  strategy!: string;

  @IsArray()
  sprints!: unknown[];
}
