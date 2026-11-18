export type Task = {
  id: string; projectId: string; parentId: string | null; order: number;
  title: string; kind: 'summary' | 'task' | 'milestone'; owner: string;
  start: string | null; end: string | null; duration: number; progress: number;
  status: string; notes: string; predecessors: string[];
};
export const stages = ['Customer Mile Stone', 'RFQ Quotation', 'Project kick off', 'CV', 'DV', 'PV', 'PPAP', 'SOP'];
export const DAY = 86400000;
const inputError = (message: string) => Object.assign(Error(message), {status:400});
export function dateValue(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw inputError('日期格式应为 YYYY-MM-DD');
  const n = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value || value < '2000-01-01' || value > '2100-12-31') throw inputError('日期应在 2000–2100 年内');
  return n;
}
export const iso = (n: number) => new Date(n).toISOString().slice(0, 10);
export const isWorkday = (n: number) => ![0, 6].includes(new Date(n).getUTCDay());
export function nextWorkday(value: string, strictly = false): string {
  let n = dateValue(value) + (strictly ? DAY : 0);
  while (!isWorkday(n)) n += DAY;
  const result = iso(n); dateValue(result); return result;
}
export function finish(start: string, duration: number): string {
  let n = dateValue(nextWorkday(start));
  for (let remaining = Math.max(0, duration - 1); remaining > 0;) { n += DAY; if (isWorkday(n)) remaining--; }
  const result = iso(n); dateValue(result); return result;
}
export function workdays(start: string, end: string): number {
  let n = dateValue(start), stop = dateValue(end), count = 0;
  if (stop < n) throw inputError('结束日期不能早于开始日期');
  for (; n <= stop; n += DAY) if (isWorkday(n)) count++;
  return count;
}
export function template(projectId: string): Task[] {
  return stages.map((title, order) => ({ id: `${projectId}-stage-${order + 1}`, projectId, parentId: null, order, title, kind: 'summary', owner: '', start: null, end: null, duration: 0, progress: 0, status: '计划中', notes: '', predecessors: [] }));
}
// Decimal totals stay exact even for fractional input; no rounding at intermediate groups.
// These BigInts are transient calculation values and are never persisted or sent as JSON.
export type ProgressTotals = { weighted: bigint; weight: bigint; scale: number };
export const leafTotals = (task: Task): ProgressTotals => {
  const weight = BigInt(Math.max(1, task.duration));
  const [mantissa, exponent = '0'] = String(task.progress).split('e');
  const decimalPlaces = mantissa.split('.')[1]?.length || 0;
  const power = Number(exponent) - decimalPlaces;
  const coefficient = BigInt(mantissa.replace('.', ''));
  return { weight, weighted: coefficient * weight * 10n ** BigInt(Math.max(0,power)), scale: Math.max(0,-power) };
};
export const sumTotals = (values: ProgressTotals[]): ProgressTotals => values.reduce((sum, value) => {
  const scale = Math.max(sum.scale, value.scale);
  return { weight: sum.weight + value.weight, scale,
    weighted: sum.weighted * 10n ** BigInt(scale-sum.scale) + value.weighted * 10n ** BigInt(scale-value.scale) };
}, { weight: 0n, weighted: 0n, scale: 0 });
export const progressPercent = (total: ProgressTotals): number => {
  if (!total.weight) return 0;
  const denominator = total.weight * 10n ** BigInt(total.scale);
  return Number((2n * total.weighted + denominator) / (2n * denominator));
};
export const projectProgress = (tasks: Task[]): number => progressPercent(sumTotals(tasks.filter(t => t.kind !== 'summary').map(leafTotals)));

export function schedule(input: Task[]): Task[] {
  const tasks = structuredClone(input), byId = new Map(tasks.map(t => [t.id, t]));
  const children = (id: string) => tasks.filter(t => t.parentId === id);
  if (byId.size !== tasks.length) throw inputError('任务编号重复');
  for (const t of tasks) {
    if (!t.title.trim() || t.title.length > 200) throw inputError('任务名称不能为空且最多 200 字');
    if (!['summary','task','milestone'].includes(t.kind)) throw inputError('任务类型无效');
    if (children(t.id).length) t.kind = 'summary';
    if (t.kind !== 'summary' && (!Number.isInteger(t.duration) || t.duration < 0 || t.duration > 2600)) throw inputError('工期应为 0–2600 个工作日');
    if (t.kind !== 'summary' && (!Number.isFinite(t.progress) || t.progress < 0 || t.progress > 100)) throw inputError('进度应在 0–100 之间');
    const seen = new Set([t.id]); let p = t.parentId;
    while (p) { if (seen.has(p)) throw inputError('任务层级不能循环'); seen.add(p); const parent = byId.get(p); if (!parent) throw inputError('父任务不存在'); if (parent.projectId !== t.projectId) throw inputError('父任务必须属于同一项目'); p = parent.parentId; }
    if (t.kind === 'summary' && t.predecessors.length) throw inputError('请在子任务上设置前置任务，汇总阶段不设置依赖');
    for (const id of t.predecessors) {
      const predecessor = byId.get(id);
      if (!predecessor || predecessor.projectId !== t.projectId) throw inputError('前置任务不存在或不属于本项目');
      if (predecessor.kind === 'summary' || children(id).length) throw inputError('前置任务须为普通任务或里程碑');
    }
    if (t.kind !== 'summary' && t.start) t.start = nextWorkday(t.start);
    if (t.kind === 'milestone') t.duration = 0;
    else if (t.kind === 'task' && !t.duration) t.duration = 1;
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(t: Task) {
    if (visiting.has(t.id)) throw inputError('前置关系形成循环，请修改依赖');
    if (visited.has(t.id)) return;
    visiting.add(t.id);
    for (const id of t.predecessors) {
      const p = byId.get(id)!; visit(p);
      if (!p.end) throw inputError('请先为前置任务设置日期');
      const earliest = nextWorkday(p.end, true);
      if (!t.start || t.start < earliest) t.start = earliest;
    }
    if (t.kind !== 'summary') {
      t.end = t.start ? finish(t.start, t.duration) : null;
      t.status = t.progress === 100 ? '已完成' : t.status === '已暂停' ? '已暂停' : t.progress > 0 ? '进行中' : '计划中';
    }
    visiting.delete(t.id); visited.add(t.id);
  }
  tasks.filter(t => t.kind !== 'summary').forEach(visit);
  function rollup(t: Task): ProgressTotals {
    const items = children(t.id);
    if (t.kind !== 'summary') return leafTotals(t);
    const totals = items.map(rollup), dated = items.filter(x => x.start && x.end);
    t.start = dated.length ? dated.map(x => x.start!).sort()[0] : null;
    t.end = dated.length ? dated.map(x => x.end!).sort().at(-1)! : null;
    t.duration = t.start && t.end ? workdays(t.start, t.end) : 0;
    const total = sumTotals(totals);
    t.progress = progressPercent(total);
    t.status = t.progress === 100 ? '已完成' : t.progress > 0 ? '进行中' : '计划中';
    return total;
  }
  tasks.filter(t => !t.parentId).forEach(rollup);
  return tasks;
}

/** Local preview for a failed inline edit; server scheduling remains authoritative. */
export function previewTaskEdit(task: Task, patch: Partial<Task>): Task {
  const value = { ...structuredClone(task), ...patch };
  if (value.kind === 'summary') return value;
  if (value.kind === 'milestone') { value.duration = 0; if (patch.end) value.start = nextWorkday(patch.end); }
  if (value.start) {
    value.start = nextWorkday(value.start);
    if (value.kind === 'task' && patch.end) value.duration = workdays(value.start, patch.end);
    if (value.kind === 'task') value.duration = Math.max(1,value.duration);
    value.end = finish(value.start,value.duration);
  } else value.end = null;
  return value;
}
