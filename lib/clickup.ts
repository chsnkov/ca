import { createHmac } from 'crypto';
const API='https://api.clickup.com/api/v2';

const token=()=>{if(!process.env.CLICKUP_TOKEN)throw new Error('no token');return process.env.CLICKUP_TOKEN};
const req=async(p:string,i?:any)=>{const r=await fetch(API+p,{...i,headers:{Authorization:token(),'Content-Type':'application/json'}});if(!r.ok)throw new Error(await r.text());return r.json()};
const norm=(v:string)=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');

export const getTask=(id:string)=>req(`/task/${id}`);

export async function syncParentTask(id:string){
 const t=await getTask(id);const list=t.list?.id;if(!list)return{updated:0,skipped:0,ignored:0,errors:0,details:[{parentId:id,parentName:t.name||'',action:'ignored',reason:'parent_has_no_list'}]};
 const data=await req(`/list/${list}/task?subtasks=true`);const tasks=data.tasks||[];
 const fields=(await req(`/list/${list}/field`)).fields||[];
 let u=0,s=0,i=0,e=0;const details:any[]=[];
 for(const sub of tasks){
  if(sub.parent!=id)continue;
  const base={parentId:String(id),parentName:t.name||'',subtaskId:String(sub.id||''),subtaskName:sub.name||'',subtaskStatus:sub.status?.status||'',listId:String(list)};
  const f=fields.find((x:any)=>norm(x.name)==norm(sub.name));
  if(!f){s++;details.push({...base,action:'skipped',reason:'field_not_found'});continue}
  const options=f.type_config?.options||[];
  const opt=options.find((o:any)=>norm(o.name)==norm(sub.status?.status));
  if(!opt){s++;details.push({...base,action:'skipped',reason:'status_option_not_found',fieldId:String(f.id||''),fieldName:f.name||'',availableOptions:options.map((o:any)=>o.name)});continue}
  try{
   await req(`/task/${id}/field/${f.id}`,{method:'POST',body:JSON.stringify({value:opt.id})});
   u++;
   details.push({...base,action:'updated',fieldId:String(f.id||''),fieldName:f.name||'',matchedOptionId:String(opt.id||''),matchedOptionName:opt.name||''});
  }catch(err:any){
   e++;
   details.push({...base,action:'error',reason:'field_update_failed',fieldId:String(f.id||''),fieldName:f.name||'',matchedOptionId:String(opt.id||''),matchedOptionName:opt.name||'',error:err instanceof Error?err.message:String(err||'unknown_error')});
  }
 }
 if(!details.length){details.push({parentId:String(id),parentName:t.name||'',action:'ignored',reason:'no_first_level_subtasks_found',listId:String(list)})}
 return{updated:u,skipped:s,ignored:i,errors:e,details};
}

export async function syncLists(ids:string[]){
 let u=0,s=0,i=0,e=0;const details:any[]=[];const discovery:any[]=[];
 for(const id of ids){
  const data=await req(`/list/${id}/task?subtasks=true`);
  const tasks=data.tasks||[];

  const rawTasks = tasks.map((t:any)=>({
    id:String(t.id||''),
    name:t.name||'',
    parent:t.parent?String(t.parent):null,
    hasParent:!!t.parent
  }));

  const parentIds:string[]=tasks
    .filter((t:any)=>t.parent&&!tasks.find((x:any)=>x.id==t.parent&&x.parent))
    .map((t:any)=>String(t.parent));

  const parents=new Set<string>(parentIds);

  discovery.push({
    listId:String(id),
    totalTasks:tasks.length,
    detectedParents:[...parents],
    rawTasks:rawTasks.slice(0,200)
  });

  if(!parents.size){
   details.push({listId:String(id),action:'ignored',reason:'no_parent_tasks_detected'});
  }

  for(const p of parents){
    const r=await syncParentTask(p);
    u+=r.updated;
    s+=r.skipped;
    i+=r.ignored;
    e+=r.errors;
    details.push(...(r.details||[]));
  }
 }
 return{updated:u,skipped:s,ignored:i,errors:e,details,discovery};
}

export const verifyWebhook=(body:string,secret:string,sig:string)=>createHmac('sha256',secret).update(body).digest('hex')===sig;

export async function getLists(){
 const teams=(await req('/team')).teams||[];let out:any[]=[];
 for(const t of teams){const spaces=(await req(`/team/${t.id}/space`)).spaces||[];
  for(const s of spaces){const folders=(await req(`/space/${s.id}/folder`)).folders||[];
   for(const f of folders){const lists=(await req(`/folder/${f.id}/list`)).lists||[];
    for(const l of lists)out.push({id:l.id,name:l.name})}}
 }
 return out;
}
