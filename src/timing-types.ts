import type {Project} from '../lib/contracts.ts';
import type {Task} from '../lib/schedule.ts';
import type {Capability} from '../lib/policy.ts';
import type {PlanSnapshot} from '../lib/timing-versions.ts';
export type DraftMetadata={id:string;revision:number;sourceVersion:string|null;sourceRevision:number;sourceLabel:string;actorUid:string;actorName:string;savedAt:string};
export type EditorLease={actorUid:string;actorName:string;expiresAt:number};
export type TimingSnapshot={project:Project;tasks:Task[];attachments:{id:string;task_id:string;name:string;size:number;created_at:string}[];revision:number;executionRevision?:number;executionTaskIds?:string[];draft?:DraftMetadata|null;editor?:EditorLease|null;members:{user?:{name:string}}[];capabilities:Capability[];schedulePolicy?:PlanSnapshot['schedulePolicy']};
export type TaskMutationResponse={tasks:Task[];project:Project;revision:number;draft:DraftMetadata;id?:string};
