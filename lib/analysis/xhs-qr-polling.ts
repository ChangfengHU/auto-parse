export function startXhsQrPolling<T extends {status_text?:string}>(
 poll:(signal:AbortSignal)=>Promise<T>,onUpdate:(value:T)=>void,onError:(error:unknown)=>void,interval=3000,
){
 const abort=new AbortController();let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
 const stop=()=>{stopped=true;if(timer)clearTimeout(timer);abort.abort();};
 const tick=async()=>{
  try{
   const value=await poll(abort.signal);if(stopped)return;
   onUpdate(value);
   if(['success','expired','failed'].includes(value.status_text||'')){stop();return;}
   if(!stopped)timer=setTimeout(()=>void tick(),interval);
  }catch(error){if(stopped)return;stop();onError(error);}
 };
 void tick();return stop;
}
