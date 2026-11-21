import type { Page, Locator } from 'playwright';

export type DouyinPublicationSettings = {
  visibility: 'public' | 'friends' | 'private';
  allowDownload: boolean;
  collectionName: string | null;
  scheduledAt: string | null;
};
export class DouyinSettingsError extends Error {
  constructor(public code: string, public field: string, public stage: string) { super(code); this.name = 'DouyinSettingsError'; }
}
export function normalizeDouyinSettings(input: unknown): DouyinPublicationSettings | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('publication_settings_invalid');
  const x = input as Record<string, unknown>;
  if (Object.keys(x).some(k => !['visibility','allowDownload','collectionName','scheduledAt'].includes(k))) throw Error('publication_settings_unsupported');
  if (x.visibility !== undefined && !['public','friends','private'].includes(String(x.visibility))) throw Error('publication_visibility_invalid');
  if (x.allowDownload !== undefined && typeof x.allowDownload !== 'boolean') throw Error('publication_download_permission_invalid');
  if (x.collectionName !== undefined && x.collectionName !== null &&
    (typeof x.collectionName !== 'string' || !x.collectionName.trim() || x.collectionName.trim().length > 100)) throw Error('publication_collection_invalid');
  let scheduledAt: string | null = null;
  if (x.scheduledAt !== undefined && x.scheduledAt !== null) {
    if (typeof x.scheduledAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00(?:\.000)?(?:Z|[+-]\d\d:\d\d)$/.test(x.scheduledAt) || !Number.isFinite(Date.parse(x.scheduledAt))) throw Error('publication_schedule_invalid');
    const [year,month,day]=x.scheduledAt.slice(0,10).split('-').map(Number);
    if(day>new Date(Date.UTC(year,month,0)).getUTCDate())throw Error('publication_schedule_invalid');
    scheduledAt = new Date(x.scheduledAt).toISOString();
  }
  return {visibility: (x.visibility || 'public') as DouyinPublicationSettings['visibility'], allowDownload: x.allowDownload === undefined ? true : x.allowDownload as boolean,
    collectionName: x.collectionName == null ? null : String(x.collectionName).trim(), scheduledAt};
}
export function validateDouyinSchedule(scheduledAt: string, now = Date.now()) {
  const time = Date.parse(scheduledAt);
  if (time < now + 2 * 3600000 || time > now + 14 * 86400000) throw Error('publication_schedule_outside_window');
}
export function scheduledDisplay(scheduledAt: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(scheduledAt));
  const v = Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return v.year+'-'+v.month+'-'+v.day+' '+v.hour+':'+v.minute;
}
export function douyinSettingsSection(page: Page, heading: string) {
  return page.locator('[class*="new-layout-"]').filter({has:page.getByText(heading,{exact:true})});
}
async function choose(page: Page, heading: string, text: string) {
  const group = douyinSettingsSection(page, heading);
  const label = group.locator('label').filter({hasText:new RegExp('^'+text+'\\s*$')});
  if (await group.count() !== 1 || await label.count() !== 1) throw Error('publication_settings_control_unconfirmed');
  const selected = (el: Element) => el.getAttribute('data-checked') === 'true';
  if (!await label.evaluate(selected)) await label.click({timeout:15000});
  const handle = await label.elementHandle();
  if (!handle) throw Error('publication_settings_control_unconfirmed');
  await page.waitForFunction(selected, handle, {timeout:10000});
}
export async function readDouyinSelection(group: Locator): Promise<string> {
  return group.locator('label[data-checked="true"]').innerText({timeout:10000}).then(x=>x.trim());
}
export function douyinCollectionPicker(page: Page) {
  return douyinSettingsSection(page,'添加合集').locator('.semi-select:not([class*="select-mix-type-"])');
}
export async function chooseDouyinCollection(page: Page, name: string | null) {
  const picker = douyinCollectionPicker(page);
  if (await picker.count() !== 1) throw Error('publication_collection_control_unconfirmed');
  const current=(await picker.innerText()).trim();
  if(name===null&&['不选择合集','请选择合集'].includes(current))return{name:null,observedNames:[],complete:false};
  await picker.click({timeout:15000});
  let observedNames:string[]=[];
  const option = page.getByRole('option').filter({hasText:new RegExp('^'+(name ?? '不选择合集').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')}).and(page.locator(':visible'));
  try {
    await option.first().waitFor({state:'visible',timeout:10000});
    if (await option.count() !== 1) throw Error('publication_collection_ambiguous');
    observedNames=await page.getByRole('option').and(page.locator(':visible')).allTextContents();
    await option.click({timeout:10000});
    await page.keyboard.press('Escape');
    await page.getByRole('listbox').and(page.locator(':visible')).waitFor({state:'hidden',timeout:3000});
  } catch (error) {
    await page.keyboard.press('Escape').catch(()=>{});
    if (error instanceof Error && error.message === 'publication_collection_ambiguous') throw error;
    throw Error('publication_collection_not_found');
  }
  const text = (await picker.innerText()).trim();
  if (name ? text !== name : !['不选择合集','请选择合集'].includes(text)) throw Error('publication_collection_not_applied');
  return {name,observedNames:observedNames.map(x=>x.trim()).filter(x=>!['请选择合集','不选择合集'].includes(x)),complete:false};
}
export async function applyDouyinSettings(page: Page, value: unknown, emit?: (message:string)=>void) {
  const settings = normalizeDouyinSettings(value);
  if (!settings) return null;
  let field = 'visibility', stage = 'apply';
  try {
    await choose(page,'谁可以看',{public:'公开',friends:'好友可见',private:'仅自己可见'}[settings.visibility]);
    field = 'allowDownload';
    await choose(page,'保存权限',settings.allowDownload?'允许':'不允许');
    field = 'crossPosting';
    const sync = douyinSettingsSection(page,'同时发布');
    if (await sync.count()) await choose(page,'同时发布','不同时发布');
    field = 'collectionName';
    const collection = await chooseDouyinCollection(page,settings.collectionName);
    const collectionName=collection.name;
    field = 'scheduledAt';
    await choose(page,'发布时间',settings.scheduledAt?'定时发布':'立即发布');
    const timeZone = await page.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone);
    let displayedTime: string | null = null;
    if (settings.scheduledAt) {
      validateDouyinSchedule(settings.scheduledAt);
      displayedTime = scheduledDisplay(settings.scheduledAt,timeZone);
      const input = douyinSettingsSection(page,'发布时间').getByPlaceholder('日期和时间',{exact:true});
      if (await input.count() !== 1) throw Error('publication_schedule_control_unconfirmed');
      await input.fill(displayedTime);
      await input.press('Enter');
      await input.press('Tab');
      if (await input.inputValue() !== displayedTime) throw Error('publication_schedule_not_applied');
    }
    stage = 'verify';
    const visibility = await readDouyinSelection(douyinSettingsSection(page,'谁可以看'));
    const download = await readDouyinSelection(douyinSettingsSection(page,'保存权限'));
    const timing = await readDouyinSelection(douyinSettingsSection(page,'发布时间'));
    if (visibility !== {public:'公开',friends:'好友可见',private:'仅自己可见'}[settings.visibility] ||
      download !== (settings.allowDownload?'允许':'不允许') || timing !== (settings.scheduledAt?'定时发布':'立即发布')) throw Error('publication_settings_not_applied');
    emit?.('已核对发布设置：'+visibility+'；'+(settings.allowDownload?'允许保存':'禁止保存')+'；'+timing+'；合集'+(collectionName||'无'));
    return {...settings, collectionOptions:collection, observedAt:new Date().toISOString(), timeZone, displayedTime, crossPosting:'none', editorVerified:true};
  } catch (error) {
    const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'publication_settings_'+stage+'_failed';
    throw new DouyinSettingsError(code, field, stage);
  }
}
