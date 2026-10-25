// IPC pause hooks exist only in this isolated worker, never in HTTP routes or deployment flags.
import { openStore } from '../../lib/database.ts';
import { dataLock } from '../../lib/data-lock.ts';
import { attachmentService } from '../../lib/attachments.ts';
const [directory,target,taskId,attachmentId]=process.argv.slice(2);
const lock=dataLock(directory,'crash-test-worker'),store=openStore(directory);
const pause=async(point:string)=>{if(point===target){process.send!({point});await new Promise(()=>{});}};
const files=attachmentService(store,pause),actor={actorId:'admin',actorName:'隔离账号',requestId:'crash-test'};
try {
  if(target.startsWith('upload-'))await files.upload(taskId,'crash.txt',(async function*(){yield Buffer.from('crash-bytes');})(),actor);
  else {files.remove(attachmentId,actor);await pause('delete-commit');await files.retry();}
}finally{store.db.close();lock.release();}
