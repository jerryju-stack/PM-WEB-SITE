import type {PlanSnapshot,TimingVersion} from './timing-versions.ts';
import type {Task} from './schedule.ts';
export const MAX_FILE_BYTES=8*1024*1024;
export const MAX_JOB_BYTES=32*1024*1024;
export type FileFormat='xlsx'|'xml'|'pdf';
export type ImportInput={file:string;format?:'xlsx'|'xml';mode?:'new'|'update';mapping?:Record<string,unknown>;draftId:string;leaseToken:string;revision:number};
export type FileTask=
 |{kind:'export';format:FileFormat;plan:PlanSnapshot;version:TimingVersion|null;signingKey?:string}
 |{kind:'preview';projectId:string;body:ImportInput;before:PlanSnapshot;signingKey?:string}
 |{kind:'confirm';tasks:Task[]};
export type FileTiming={queueMs:number;executionMs:number;computeMs:number;cold:boolean;heapUsedBytes:number};
export class FileJobError extends Error {
 status:number;code:string;
 constructor(code:string,status:number,message:string){super(message);this.name='FileJobError';this.code=code;this.status=status;}
}
export const fileCancelled=()=>new FileJobError('FILE_CANCELLED',499,'文件请求已取消，未提交处理结果');
