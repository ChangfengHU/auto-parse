import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=stripTypeScriptTypes(await readFile(new URL('../lib/workflow/task-store.ts',import.meta.url),'utf8'),{mode:'transform'});
const fn=source.match(/export function setTaskStepError\([\s\S]*?\n\}/)?.[0].replace('export ','');
assert.ok(fn);
test('failed publication keeps structured evidence through persistence and reload',()=>{
 const task={steps:[{status:'running',logs:[]}]},store=new Map([['original',task]]);let disk=null;
 const sandbox={TASK_STORE:store,persistWorkflowTask:v=>{disk=JSON.stringify(v)},parseWorkflowStepErrorMessage:error=>({error_code:'ERROR',error_msg:error})};
 vm.createContext(sandbox);vm.runInContext(fn+';globalThis.setError=setTaskStepError',sandbox);
 const output={publicationDiagnostic:{stage:'publish_control',submissionState:'not_submitted',error:'publication_control_not_actionable',viewport:{width:1440,height:1000}}};
 sandbox.setError('original',0,'publication_control_not_actionable',15000,{output,screenshot:'fixture'});
 const reloaded=JSON.parse(disk);assert.deepEqual(reloaded.steps[0].output,output);assert.equal(reloaded.steps[0].status,'error');assert.equal(reloaded.steps[0].screenshot,'fixture');
});
test('ordinary failures do not retain a previous success output',()=>{
 const task={steps:[{output:{old:'stale'}}]},store=new Map([['original',task]]);
 const sandbox={TASK_STORE:store,persistWorkflowTask:()=>{},parseWorkflowStepErrorMessage:error=>({error_code:'ERROR',error_msg:error})};
 vm.createContext(sandbox);vm.runInContext(fn+';globalThis.setError=setTaskStepError',sandbox);sandbox.setError('original',0,'failed',1);assert.equal(task.steps[0].output,undefined);
});
