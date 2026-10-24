/** A local edit is independent of reloads. Reading latest never authorizes a retry. */
export class EditDraft<T extends object> {
  value: T;
  private original: T;
  version: number;
  dirty = false;
  message = '';
  latest?: { value: T; version: number };
  constructor(value: T, version: number) { this.value=structuredClone(value);this.original=structuredClone(value);this.version=version; }
  set(value: T) { this.value=structuredClone(value);this.dirty=JSON.stringify(this.value)!==JSON.stringify(this.original); }
  fail(message: string) { this.message=message; this.dirty=true; }
  review(value: T, version: number) { this.latest={value:structuredClone(value),version}; }
  useReviewedVersion() {
    if(!this.latest)throw Error('请先查看最新数据');
    this.version=this.latest.version;this.latest=undefined;this.message='已选择最新版本。请核对草稿后再次保存。';
  }
}
