import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Creates definitions only. Every draft, work and processing action belongs to
// the browser journey, never to this fixture preparation script.
const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const localRoot = join(projectRoot, '.local');
const runtime = resolve(process.argv[2] || '');
if (!runtime.startsWith(localRoot + sep)) throw new Error('Only a project-local isolated runtime is allowed.');
const readJson = async (name) => {
  try { return JSON.parse((await readFile(join(runtime, name), 'utf8')).replace(/^\uFEFF/, '')); }
  catch { throw new Error(`Cannot read private ${name}; no configuration contents are printed.`); }
};
const environment = await readJson('integration-environment.json');
const original = await readJson('integration-seed.json');
if (environment.host !== '127.0.0.1' || !/^companyoait\d{8}[a-f0-9]{8}$/.test(environment.database))
  throw new Error('Only the isolated integration database is allowed.');
if (!original.passwordA || !original.passwordB || !/^[a-f0-9]{8}$/.test(original.suffix))
  throw new Error('Existing normal integration accounts are required.');
const origin = `http://127.0.0.1:${Number(environment.applicationPort)}`;
const fixturePath = join(runtime, 'integration-ux-seed.json');
let fixture;
try { fixture = JSON.parse(await readFile(fixturePath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw new Error('Cannot read the private UX fixture receipt.');
  fixture = { version: 1, suffix: original.suffix, ids: {}, createdAt: new Date().toISOString() };
}
if (fixture.suffix !== original.suffix) throw new Error('UX fixture belongs to a different test database.');
const save = () => writeFile(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
let step = 'connect';
const sessions = [];
async function request(service, path, token, method = 'GET', body) {
  const response = await fetch(new URL(`/x_${service}/jaxrs/${path}`, origin), {
    method, redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { 'x-token': token, Authorization: token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error(`${step}: HTTP ${response.status}, invalid JSON`); }
  if (!response.ok || result.type !== 'success') throw new Error(`${step}: HTTP ${response.status}, platform request failed; inspect only redacted diagnostics.`);
  return result.data;
}
async function login(credential, password) {
  const user = await request('organization_assemble_authentication', 'authentication', '', 'POST', { credential, password });
  if (!user?.token || user.tokenType === 'anonymous') throw new Error(`${step}: authenticated session missing`);
  sessions.push(user.token); return user;
}
function identityOf(user) {
  const item = user.identityList?.find((entry) => typeof entry === 'string' || entry?.distinguishedName);
  const id = typeof item === 'string' ? item : item?.distinguishedName;
  if (!id) throw new Error(`${step}: normal account identity missing`);
  return id;
}
async function ensure(key, body, path) {
  if (fixture.ids[key]) {
    await request('processplatform_assemble_designer', `${path}/${encodeURIComponent(fixture.ids[key])}`, admin.token);
    return fixture.ids[key];
  }
  step = `create-${key}`;
  const result = await request('processplatform_assemble_designer', path, admin.token, 'POST', body);
  if (!result?.id) throw new Error(`${step}: created identifier missing`);
  fixture.ids[key] = result.id; await save(); return result.id;
}
let admin;
try {
  step = 'login-existing-accounts';
  admin = await login(environment.adminCredential, environment.adminPassword);
  const credentialA = `oa_it_a_${original.suffix}`, credentialB = `oa_it_b_${original.suffix}`;
  const userA = await login(credentialA, original.passwordA), userB = await login(credentialB, original.passwordB);
  const identityA = identityOf(userA), identityB = identityOf(userB);
  const appName = `Web旅程联调-${fixture.suffix}`;
  const appId = await ensure('application', { name: appName, alias: `oa_ux_app_${fixture.suffix}`,
    description: '专用测试库中的合成用户旅程定义，不代表公司既有业务。' }, 'application');
  fixture.formId ||= randomUUID();
  fixture.definitionIds ||= Object.fromEntries(['process', 'begin', 'manualA', 'manualB', 'end', 'route0', 'route1', 'route2'].map((key) => [key, randomUUID()]));
  await save();
  const formId = fixture.formId;
  const formData = {
    json: { id: formId, name: `Web旅程表单-${fixture.suffix}`, type: 'Form', mode: 'PC', application: appId,
      applicationName: appName, description: '真实 MWF 可编辑中文备注与系统流转工具栏',
      styles: { padding: '24px' }, properties: {}, cssLinks: [], scriptSrc: [],
      jsheader: { code: '', html: '' }, submitScript: { code: '', html: '' }, events: {}, isReadonly: false,
      moduleList: {
        ux_actions: { id: 'ux_actions', name: '系统操作', type: 'Actionbar', style: 'xform_blue_simple',
          hideSystemTools: false, hideReadedAction: true, tools: [], properties: {}, styles: {}, events: {}, container: '',
          defaultTools: [
            { type: 'MWFToolBarButton', img: 'save.png', title: '保存工作', action: 'saveWork', text: '保存', control: 'allowSave', id: 'action_saveData', read: false },
            { type: 'MWFToolBarButton', img: 'submit.png', title: '继续流转文件', action: 'processWork', text: '继续流转', control: 'allowProcessing', id: 'action_processWork', read: false },
          ] },
        note: { id: 'note', name: '申请备注', type: 'Textfield', dataType: 'text', compute: 'create', section: 'no',
          sectionBy: 'person', sectionByScript: { code: '', html: '' }, defaultValue: { code: '', html: '' },
          events: {}, inputType: 'text', properties: { placeholder: '请输入中文申请备注' }, class: '', styles: {}, container: '', isReadonly: false },
      }, fieldList: {},
    },
    html: `<div MWFType="form" id="${formId}"><div id="ux_actions" MWFType="actionbar"><div></div></div><h2>Web 发起与办理联调</h2><label for="note">申请备注</label><div id="note" MWFType="textfield"></div></div>`,
  };
  await ensure('form', { id: formId, name: `Web旅程表单-${fixture.suffix}`, alias: `oa_ux_form_${fixture.suffix}`,
    application: appId, hasMobile: false, data: JSON.stringify(JSON.stringify(formData)).slice(1, -1),
    formFieldList: [{ name: 'note', dataType: 'string' }], relatedFormList: [], mobileRelatedFormList: [], relatedScriptMap: {}, mobileRelatedScriptMap: {} }, 'form');
  const ids = fixture.definitionIds;
  const processName = `Web草稿发起审批-${fixture.suffix}`;
  const processId = await ensure('process', { id: ids.process, name: processName, alias: `oa_ux_flow_${fixture.suffix}`,
    application: appId, expireType: 'never', defaultStartMode: 'draft', startableTerminal: 'all', startableIdentityList: [identityA],
    begin: { id: ids.begin, name: '开始', form: formId, route: ids.route0 },
    manualList: [
      { id: ids.manualA, name: '发起填报', form: formId, manualMode: 'single', taskExpireType: 'never', taskIdentityList: [identityA], routeList: [ids.route1] },
      { id: ids.manualB, name: '审批', form: formId, manualMode: 'single', taskExpireType: 'never', taskIdentityList: [identityB], routeList: [ids.route2] },
    ], endList: [{ id: ids.end, name: '结束', form: formId }],
    routeList: [
      { id: ids.route0, name: '进入填报', activityType: 'manual', activity: ids.manualA },
      { id: ids.route1, name: '提交', activityType: 'manual', activity: ids.manualB },
      { id: ids.route2, name: '同意', activityType: 'end', activity: ids.end },
    ],
  }, 'process');
  step = 'verify-startable-catalogue';
  const applications = await request('processplatform_assemble_surface', 'application/list/terminal/client', userA.token);
  if (!Array.isArray(applications) || !applications.some((app) => app.id === appId && app.processList?.some((p) => p.id === processId)))
    throw new Error(`${step}: synthetic process is not startable by normal requester`);
  const configPath = join(localRoot, 'ux-live-integration.json');
  await writeFile(configPath, JSON.stringify({ version: 1, webBaseUrl: 'http://127.0.0.1:5173',
    platformWebUrl: `http://127.0.0.1:${Number(environment.webPort)}`, runtimeRoot: relative(projectRoot, runtime),
    applicationId: appId, applicationName: appName, processId, processName, expectedMode: 'draft', formId,
    titlePrefix: `UX-LIVE-${fixture.suffix}`, notePrefix: '真实Web发起的中文申请备注',
    requester: { credential: credentialA, password: original.passwordA, expectedDisplayName: userA.name },
    approver: { credential: credentialB, password: original.passwordB, expectedDisplayName: userB.name },
  }, null, 2) + '\n', 'utf8');
  fixture.status = 'ready-for-ui-launch'; fixture.updatedAt = new Date().toISOString(); delete fixture.failedStep; await save();
  console.log(JSON.stringify({ status: fixture.status, mode: 'draft', config: relative(projectRoot, configPath),
    definitionsCreated: 3, worksCreatedBySeed: 0, historicalFlowChanged: false, credentialsPrinted: false }));
} catch {
  fixture.failedStep = step; await save();
  console.error(`UX fixture failed at ${step}; inspect only sanitized diagnostics. No credentials printed.`);
  process.exitCode = 1;
} finally {
  for (const token of sessions) {
    try { await request('organization_assemble_authentication', 'authentication', token, 'DELETE'); }
    catch { console.error('A fixture session could not be confirmed logged out; no credentials printed.'); process.exitCode = 1; }
  }
}
