import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const localRoot = join(projectRoot, ".local");
const runtime = resolve(process.argv[2] || "");
if (!runtime.startsWith(localRoot + sep))
  throw new Error("Only a project-local integration runtime is allowed.");
const environment = JSON.parse(
  await readFile(join(runtime, "integration-environment.json"), "utf8"),
);
if (
  environment.host !== "127.0.0.1" ||
  !/^companyoait\d{8}[a-f0-9]{8}$/.test(environment.database)
) {
  throw new Error("The runtime must use the isolated integration database.");
}
const origin = `http://127.0.0.1:${environment.applicationPort}`;
const seedFile = join(runtime, "integration-seed.json");
let seed;
try {
  seed = JSON.parse(await readFile(seedFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const suffix = environment.database.slice(-8);
  seed = {
    suffix,
    passwordA: randomBytes(24).toString("hex") + "!Aa1",
    passwordB: randomBytes(24).toString("hex") + "!Bb2",
    ids: {},
    createdAt: new Date().toISOString(),
  };
}
const save = () =>
  writeFile(seedFile, JSON.stringify(seed, null, 2) + "\n", "utf8");
await save();
let step = "connect";

async function request(service, path, token, method = "GET", body) {
  const url = new URL(`/x_${service}/jaxrs/${path}`, origin);
  const response = await fetch(url, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(60000),
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { "x-token": token, Authorization: token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${step}: HTTP ${response.status}, non-JSON response`);
  }
  if (!response.ok || payload.type !== "success") {
    // Do not log response bodies: platform errors may include user input or secrets.
    const prompt = /^[\w.]+$/.test(payload.prompt || "")
      ? payload.prompt
      : "logical-error";
    throw new Error(`${step}: HTTP ${response.status}, ${prompt}`);
  }
  return payload;
}

async function login(credential, password) {
  const response = await request(
    "organization_assemble_authentication",
    "authentication",
    "",
    "POST",
    { credential, password },
  );
  if (!response.data?.token || response.data.tokenType === "anonymous")
    throw new Error(`${step}: authenticated token missing`);
  return response.data;
}

async function ensureId(key, service, path, token, body) {
  if (seed.ids[key]) return seed.ids[key];
  step = `create-${key}`;
  const result = await request(service, path, token, "POST", body);
  if (!result.data?.id) throw new Error(`${step}: created ID missing`);
  seed.ids[key] = result.data.id;
  await save();
  return result.data.id;
}

async function taskList(token, query, excludeDraft) {
  return (
    await request(
      "processplatform_assemble_surface",
      "task/v2/list/paging/1/size/50",
      token,
      "POST",
      { key: query, isExcludeDraft: excludeDraft },
    )
  ).data;
}

function identityOf(user) {
  const item = user.identityList?.find(
    (value) => typeof value === "string" || value.distinguishedName,
  );
  const identity = typeof item === "string" ? item : item?.distinguishedName;
  if (!identity) throw new Error(`${step}: normal user identity missing`);
  return identity;
}

try {
  step = "login-admin";
  const admin = await login(
    environment.adminCredential,
    environment.adminPassword,
  );
  const control = "organization_assemble_control";
  const designer = "processplatform_assemble_designer";
  const unitId = await ensureId("unit", control, "unit", admin.token, {
    name: `独立联调组织-${seed.suffix}`,
    unique: `oa_it_unit_${seed.suffix}`,
  });
  const credentialA = `oa_it_a_${seed.suffix}`,
    credentialB = `oa_it_b_${seed.suffix}`;
  await ensureId("personA", control, "person", admin.token, {
    name: `联调发起人-${seed.suffix}`,
    unique: credentialA,
    mobile: `IT${seed.suffix}A`,
    password: seed.passwordA,
    unit: unitId,
  });
  await ensureId("personB", control, "person", admin.token, {
    name: `联调审批人-${seed.suffix}`,
    unique: credentialB,
    mobile: `IT${seed.suffix}B`,
    password: seed.passwordB,
    unit: unitId,
  });
  step = "login-normal-users";
  const userA = await login(credentialA, seed.passwordA);
  const userB = await login(credentialB, seed.passwordB);
  const identityA = identityOf(userA),
    identityB = identityOf(userB);
  const appId = await ensureId(
    "application",
    designer,
    "application",
    admin.token,
    {
      name: `独立联调应用-${seed.suffix}`,
      alias: `oa_it_app_${seed.suffix}`,
      description: "隔离测试库中的合成连通性流程，不代表原业务规则。",
    },
  );
  const formId = (seed.formId ||= randomUUID());
  await save();
  const formData = {
    json: {
      id: formId,
      name: `原生联调表单-${seed.suffix}`,
      type: "Form",
      mode: "PC",
      application: appId,
      applicationName: `独立联调应用-${seed.suffix}`,
      description: "合成测试表单",
      styles: { padding: "24px" },
      properties: {},
      cssLinks: [],
      scriptSrc: [],
      jsheader: { code: "", html: "" },
      submitScript: { code: "", html: "" },
      events: {},
      moduleList: {
        note: {
          id: "note",
          name: "联调说明",
          type: "Textfield",
          dataType: "text",
          compute: "create",
          section: "no",
          sectionBy: "person",
          sectionByScript: { code: "", html: "" },
          defaultValue: { code: "", html: "" },
          events: {},
          inputType: "text",
          properties: {},
          class: "",
          styles: {},
          container: "",
          isReadonly: true,
        },
      },
      fieldList: {},
      isReadonly: true,
    },
    html: `<div MWFType="form" id="${formId}"><h2>原生表单联调</h2><div id="note" MWFType="textfield"></div></div>`,
  };
  await ensureId("form", designer, "form", admin.token, {
    id: formId,
    name: `原生联调表单-${seed.suffix}`,
    alias: `oa_it_form_${seed.suffix}`,
    application: appId,
    hasMobile: false,
    data: JSON.stringify(JSON.stringify(formData)).slice(1, -1),
    formFieldList: [{ name: "note", dataType: "string" }],
    relatedFormList: [],
    mobileRelatedFormList: [],
    relatedScriptMap: {},
    mobileRelatedScriptMap: {},
  });
  seed.definitionIds ||= Object.fromEntries(
    [
      "process",
      "begin",
      "manualA",
      "manualB",
      "end",
      "route0",
      "route1",
      "route2",
    ].map((key) => [key, randomUUID()]),
  );
  await save();
  const ids = seed.definitionIds;
  const processId = await ensureId(
    "process",
    designer,
    "process",
    admin.token,
    {
      id: ids.process,
      name: `独立联调流程-${seed.suffix}`,
      alias: `oa_it_flow_${seed.suffix}`,
      application: appId,
      expireType: "never",
      startableIdentityList: [identityA],
      begin: { id: ids.begin, name: "开始", form: formId, route: ids.route0 },
      manualList: [
        {
          id: ids.manualA,
          name: "发起填报",
          form: formId,
          manualMode: "single",
          taskExpireType: "never",
          taskIdentityList: [identityA],
          routeList: [ids.route1],
        },
        {
          id: ids.manualB,
          name: "审批",
          form: formId,
          manualMode: "single",
          taskExpireType: "never",
          taskIdentityList: [identityB],
          routeList: [ids.route2],
        },
      ],
      endList: [{ id: ids.end, name: "结束", form: formId }],
      routeList: [
        {
          id: ids.route0,
          name: "进入填报",
          activityType: "manual",
          activity: ids.manualA,
        },
        {
          id: ids.route1,
          name: "提交",
          activityType: "manual",
          activity: ids.manualB,
        },
        {
          id: ids.route2,
          name: "同意",
          activityType: "end",
          activity: ids.end,
        },
      ],
    },
  );
  const title = `IT-SMOKE-${seed.suffix}`;
  if (!seed.ids.work) {
    step = "start-real-work";
    const created = await request(
      "processplatform_assemble_surface",
      `work/process/${encodeURIComponent(processId)}`,
      userA.token,
      "POST",
      {
        title,
        identity: identityA,
        data: { integrationMarker: title, note: "独立测试库中的合成业务数据" },
      },
    );
    const work = created.data?.[0];
    seed.ids.work = work?.work || work?.id;
    if (!seed.ids.work) throw new Error("start-real-work: work ID missing");
    await save();
  }
  step = "submit-first-node";
  let pending = await taskList(userB.token, title, true);
  if (!pending.some((task) => task.title === title)) {
    const drafts = await taskList(userA.token, title, false);
    const first = drafts.find((task) => task.title === title);
    if (!first) throw new Error("submit-first-node: requester task missing");
    await request(
      "processplatform_assemble_surface",
      `task/${encodeURIComponent(first.id)}/processing`,
      userA.token,
      "POST",
      { routeName: "提交", opinion: "独立联调提交" },
    );
    for (let attempt = 0; attempt < 60; attempt++) {
      pending = await taskList(userB.token, title, true);
      if (pending.some((task) => task.title === title)) break;
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  const target = pending.find((task) => task.title === title);
  if (!target?.id || !target.work)
    throw new Error("normal-approver-pending: real non-draft task missing");
  seed.ids.work = target.work;
  seed.ids.task = target.id;
  seed.status = "ready-for-web";
  delete seed.failedStep;
  await save();
  await writeFile(
    join(localRoot, "live-integration.json"),
    JSON.stringify(
      {
        webBaseUrl: "http://127.0.0.1:5173",
        credential: credentialB,
        password: seed.passwordB,
        expectedDisplayName: userB.name,
        pendingTitle: title,
        searchTerm: title,
        nonAssignee: {
          credential: credentialA,
          password: seed.passwordA,
          expectedDisplayName: userA.name,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(
    JSON.stringify({
      status: seed.status,
      database: environment.database,
      workId: target.work,
      taskId: target.id,
      liveConfig: relative(
        projectRoot,
        join(localRoot, "live-integration.json"),
      ),
      credentialsPrinted: false,
    }),
  );
} catch (error) {
  seed.failedStep = step;
  await save();
  console.error(error.message);
  process.exitCode = 1;
}
