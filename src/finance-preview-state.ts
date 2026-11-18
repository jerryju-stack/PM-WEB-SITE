/** P07 can bind this controller to its impact panel. Both stale success and stale failure are ignored. */
export type PreviewContext={projectId:string;versionId:string;revision:number;requestKey:string};
export function createFinancePreviewCoordinator() {
  let generation=0;
  return {
    invalidate(){generation++;},
    async run<T extends PreviewContext&{clientSequence:number}>(context:PreviewContext,send:(token:PreviewContext&{clientSequence:number})=>Promise<T>) {
      const token={...context,clientSequence:++generation};
      try {
        const result=await send(token);
        if(generation!==token.clientSequence||Object.entries(token).some(([key,value])=>result[key as keyof T]!==value))return {status:'stale' as const};
        return {status:'accepted' as const,result};
      } catch(error) {return generation===token.clientSequence?{status:'failed' as const,error}:{status:'stale' as const};}
    }
  };
}
