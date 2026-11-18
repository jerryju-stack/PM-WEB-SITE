/** A local edit is independent of reloads. Reading latest never authorizes a retry. */
export class EditDraft<T extends object> {
  value: T;
  private original: T;
  private saveRequired = false;
  version: number;
  dirty = false;
  message = '';
  latest?: { value: T; version: number };
  constructor(value: T, version: number) { this.value=structuredClone(value);this.original=structuredClone(value);this.version=version; }
  set(value: T) { this.value=structuredClone(value);this.dirty=this.saveRequired||JSON.stringify(this.value)!==JSON.stringify(this.original); }
  /** Hydrated local input has no confirmed server baseline; recapture must never mark it saved. */
  requireSave() { this.saveRequired=true;this.dirty=true;return this; }
  fail(message: string) { this.message=message; this.dirty=true; }
  review(value: T, version: number) { this.latest={value:structuredClone(value),version}; }
  useReviewedVersion() {
    if(!this.latest)throw Error('请先查看最新数据');
    this.version=this.latest.version;this.latest=undefined;this.message='已选择最新版本。请核对草稿后再次保存。';
  }
}

/** Discard superseded reads; the caller also supplies its editor/mount lifetime. */
export class ReadGuard {
  private sequence = 0;
  invalidate() { this.sequence++; }
  begin(active: () => boolean = () => true) {
    const sequence = ++this.sequence;
    return () => sequence === this.sequence && active();
  }
}

/** One user transition at a time. A repeated Escape/click must not close twice. */
export class EditTransition {
  pending=false;
  async run(operation:()=>Promise<boolean>):Promise<boolean>{
    if(this.pending)return false;
    this.pending=true;
    try{return await operation();}finally{this.pending=false;}
  }
}

export type LocalTimingInputs<T extends object>={
  savedAt:string;
  inline:[string,Record<string,any>][];
  drawer?:{value:T;version:number;inputs?:Record<string,string|string[]>};
};
const localTimingInputs=new Map<string,LocalTimingInputs<any>>();
/** safeAccount.id is the immutable UID, never the reusable login name. No lease/request is stored. */
export class TimingRecovery<T extends object>{
  readonly key:string;
  private storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>;
  constructor(actorUid:string,projectId:string,storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
    this.storage=storage;
    this.key='project-station:timing-recovery:v1:'+JSON.stringify([actorUid,projectId]);
  }
  read():LocalTimingInputs<T>|undefined{
    const memory=localTimingInputs.get(this.key);if(memory)return structuredClone(memory);
    try{const raw=this.storage?.getItem(this.key);if(raw){const value=JSON.parse(raw);if(Array.isArray(value.inline)&&typeof value.savedAt==='string')return value;}}catch{/* Keep in-memory recovery when browser storage is blocked. */}
    return undefined;
  }
  write(value:LocalTimingInputs<T>){
    localTimingInputs.set(this.key,structuredClone(value));
    try{this.storage?.setItem(this.key,JSON.stringify(value));}catch{/* Memory remains available. */}
  }
  clear(){localTimingInputs.delete(this.key);try{this.storage?.removeItem(this.key);}catch{/* Storage may be unavailable. */}}
}
