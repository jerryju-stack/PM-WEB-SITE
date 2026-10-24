import { dateValue } from './schedule.ts';
import type { Task } from './schedule.ts';
export type Collection = 'projects' | 'articles';
export type Project = { id: string; version: number; taskRevision: number; title: string; description: string; category: string; date: string; startDate: string; content: string; owner: string; status: string; progress: number };
export type Article = Omit<Project, 'taskRevision'>;
export type ResourceWrite = { title?: string; description?: string; category?: string; date?: string; startDate?: string; content?: string; owner?: string; version?: number };
export type DeleteWrite = { version: number; taskRevision?: number };
export type ResourceResult = { ok: true; id: string; version: number; item: Project | Article };
export type TaskWrite = Partial<Pick<Task, 'title' | 'owner' | 'notes' | 'status' | 'parentId' | 'kind' | 'order' | 'start' | 'end' | 'duration' | 'progress' | 'predecessors'>> & { revision: number };
export type TaskResult = { tasks: Task[]; revision: number; id?: string; project: Project };
export const invalid = (message: string, status = 400): never => { throw Object.assign(Error(message), { status }); };
export function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('请求内容应为对象');
  return value as Record<string, unknown>;
}
export function versionInput(value: unknown, label = '内容'): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid('缺少或无效的'+label+'版本，请刷新客户端后重试', 409);
  return value as number;
}
function stringInput(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) invalid(field+'格式或长度无效');
  return value as string;
}
export function resourceInput(collection: Collection, value: unknown, partial = false): ResourceWrite {
  const raw = objectInput(value), out: ResourceWrite = {};
  if (!partial || raw.title !== undefined) { out.title = stringInput(raw.title, '标题', 200); if (!out.title.trim()) invalid('请填写标题'); }
  const limits = { description: 1000, category: 100, date: 10, startDate: 10, content: 500000, owner: 100 } as const;
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) if (raw[key] !== undefined) out[key] = stringInput(raw[key], key, limits[key]);
  if (!partial && collection === 'articles' && typeof raw.content !== 'string') invalid('请填写 Markdown 内容');
  for (const key of ['date','startDate'] as const) if (out[key]) dateValue(out[key]!);
  return out;
}
export function taskInput(value: unknown): TaskWrite {
  const raw = objectInput(value), out: TaskWrite = { revision: versionInput(raw.revision, '排期') };
  for (const [key, max] of [['title',200],['owner',100],['notes',20000],['status',100]] as const) if (raw[key] !== undefined) out[key] = stringInput(raw[key],key,max);
  if (out.status !== undefined && !['计划中','进行中','已暂停','已完成'].includes(out.status)) invalid('任务状态无效');
  for (const key of ['start','end','parentId'] as const) if (raw[key] !== undefined) { if (raw[key] !== null && typeof raw[key] !== 'string') invalid(key+'格式无效'); out[key] = raw[key] as string | null; }
  for (const key of ['duration','progress','order'] as const) if (raw[key] !== undefined) {
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key])) invalid(key+'应为有效数字');
    out[key] = raw[key] as number;
  }
  if (out.duration !== undefined && (!Number.isInteger(out.duration) || out.duration < 0)) invalid('工期应为非负整数');
  if (out.progress !== undefined && (out.progress < 0 || out.progress > 100)) invalid('进度应在 0–100 之间');
  if (out.order !== undefined && (!Number.isSafeInteger(out.order) || out.order < 0)) invalid('排序值无效');
  if (raw.kind !== undefined) { if (typeof raw.kind !== 'string' || !['summary','task','milestone'].includes(raw.kind)) invalid('任务类型无效');out.kind = raw.kind as Task['kind']; }
  if (raw.predecessors !== undefined) {
    if (!Array.isArray(raw.predecessors) || !raw.predecessors.every(id => typeof id === 'string')) invalid('前置任务格式无效');
    out.predecessors = [...new Set(raw.predecessors as string[])];
  }
  return out;
}
