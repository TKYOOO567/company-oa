/**
 * Verify the existing, dedicated integration workflow against the real platform.
 *
 * Usage:
 *   node deployment/dev/Verify-O2Workflow.mjs <project-.local-runtime>
 *   node deployment/dev/Verify-O2Workflow.mjs <project-.local-runtime> --read-only
 *
 * The default run may submit exactly the existing B approval via its real 同意
 * route. It never seeds another workflow, uses an administrator, or contacts the
 * old OA. --read-only performs only authentication and read/query operations.
 * Run the default only after the real browser integration checks have passed.
 */
import { readFile, realpath, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const localRoot = join(projectRoot, ".local");
const argumentsList = process.argv.slice(2);
const readOnly = argumentsList.includes("--read-only");
const startedAt = new Date().toISOString();
let step = "configuration";
let receiptPath = "";
const receipt = {
  schemaVersion: 1,
  suite: "isolated-o2oa-workflow",
  status: "not-started",
  mode: readOnly ? "read-only" : "process-known-approval",
  startedAt,
  submittedDuringThisRun: false,
  alreadyCompleted: false,
  checks: {
    isolatedDatabaseConfiguration: false,
    normalAccountsAuthenticated: false,
    knownAssigneePendingConfirmed: false,
    realApprovalRouteConfirmed: false,
    businessDataBeforeApprovalConfirmed: false,
    requesterSubmissionCompleted: false,
    assigneePendingRemoved: false,
    assigneeApprovalCompleted: false,
    noActiveWorkForJob: false,
    completedWorkMetadataConfirmed: false,
    completedBusinessDataConfirmed: false,
    chineseBusinessDataConfirmed: false,
  },
  credentialsPrinted: false,
};

class VerificationFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "VerificationFailure";
    this.code = code;
  }
}

function requireCondition(condition, code) {
  if (!condition) throw new VerificationFailure(code);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}

async function privateJson(path, errorCode) {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    // JSON.parse errors can quote source fragments containing passwords.
    throw new VerificationFailure(errorCode);
  }
}

async function saveReceipt() {
  if (!receiptPath) return;
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

async function main() {
  const positional = argumentsList.filter(
    (argument) => !argument.startsWith("--"),
  );
  requireCondition(
    positional.length === 1 &&
      argumentsList.every(
        (argument) => !argument.startsWith("--") || argument === "--read-only",
      ),
    "USAGE_RUNTIME_PATH_AND_OPTIONAL_READ_ONLY",
  );
  let runtime;
  try {
    runtime = await realpath(resolve(positional[0]));
    requireCondition(
      isInside(await realpath(localRoot), runtime),
      "RUNTIME_OUTSIDE_PROJECT_LOCAL",
    );
  } catch (error) {
    if (error instanceof VerificationFailure) throw error;
    throw new VerificationFailure("PRIVATE_RUNTIME_NOT_FOUND");
  }

  const environment = await privateJson(
    join(runtime, "integration-environment.json"),
    "INVALID_PRIVATE_ENVIRONMENT",
  );
  const seed = await privateJson(
    join(runtime, "integration-seed.json"),
    "INVALID_PRIVATE_SEED",
  );
  requireCondition(
    isObject(environment) &&
      environment.host === "127.0.0.1" &&
      /^companyoait\d{8}[a-f0-9]{8}$/.test(environment.database || "") &&
      /^oa_it_[a-f0-9]{8}$/.test(environment.databaseUser || "") &&
      Number.isSafeInteger(environment.applicationPort) &&
      environment.applicationPort >= 1024 &&
      environment.applicationPort <= 65535 &&
      environment.embeddedDatabaseEnabled === false &&
      environment.nodeAgentEnabled === false,
    "NOT_AN_ISOLATED_INTEGRATION_ENVIRONMENT",
  );
  requireCondition(
    isObject(seed) &&
      seed.suffix === environment.database.slice(-8) &&
      nonEmpty(seed.passwordA) &&
      nonEmpty(seed.passwordB) &&
      isObject(seed.ids) &&
      ["application", "process", "work", "task", "personA", "personB"].every(
        (key) => nonEmpty(seed.ids[key]),
      ) &&
      isObject(seed.definitionIds) &&
      ["manualA", "manualB", "end", "route2"].every((key) =>
        nonEmpty(seed.definitionIds[key]),
      ),
    "DEDICATED_SEED_NOT_READY",
  );
  const sources = await privateJson(
    join(runtime, "config", "externalDataSources.json"),
    "INVALID_EXTERNAL_DATABASE_CONFIGURATION",
  );
  const enabledSources = Array.isArray(sources)
    ? sources.filter((source) => source?.enable === true)
    : [];
  requireCondition(
    enabledSources.length === 1,
    "EXPECTED_ONE_ISOLATED_EXTERNAL_DATABASE",
  );
  let databaseUrl;
  try {
    databaseUrl = new URL(String(enabledSources[0].url).replace(/^jdbc:/, ""));
  } catch {
    throw new VerificationFailure("INVALID_ISOLATED_JDBC_URL");
  }
  requireCondition(
    ["mysql:", "mariadb:"].includes(databaseUrl.protocol) &&
      databaseUrl.hostname === "127.0.0.1" &&
      databaseUrl.pathname === `/${environment.database}` &&
      enabledSources[0].username === environment.databaseUser,
    "EXTERNAL_DATABASE_DOES_NOT_MATCH_ISOLATION_MARKER",
  );

  receiptPath = join(
    localRoot,
    "verification",
    readOnly ? "o2oa-workflow-read-only.json" : "o2oa-workflow.json",
  );
  Object.assign(receipt, {
    status: "running",
    runtime: relative(projectRoot, runtime).split(sep).join("/"),
    database: environment.database,
    applicationId: seed.ids.application,
    processId: seed.ids.process,
    workId: seed.ids.work,
    taskId: seed.ids.task,
  });
  receipt.checks.isolatedDatabaseConfiguration = true;
  const origin = `http://127.0.0.1:${environment.applicationPort}`;
  const surface = "processplatform_assemble_surface";
  const title = `IT-SMOKE-${seed.suffix}`;
  const knownTaskId = seed.ids.task;
  const knownWorkId = seed.ids.work;
  const applicationId = seed.ids.application;
  const processId = seed.ids.process;

  async function request(service, path, token, method = "GET", body) {
    let response;
    let envelope;
    try {
      response = await fetch(new URL(`/x_${service}/jaxrs/${path}`, origin), {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token ? { "x-token": token, Authorization: token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      envelope = await response.json();
    } catch {
      throw new VerificationFailure("PLATFORM_NETWORK_TIMEOUT_OR_NON_JSON");
    }
    requireCondition(response.ok, `PLATFORM_HTTP_${response.status}`);
    requireCondition(
      isObject(envelope) && envelope.type === "success",
      "PLATFORM_LOGICAL_FAILURE",
    );
    requireCondition(Object.hasOwn(envelope, "data"), "PLATFORM_DATA_MISSING");
    return envelope;
  }

  async function login(credential, password, expectedPersonId) {
    const result = await request(
      "organization_assemble_authentication",
      "authentication",
      "",
      "POST",
      { credential, password },
    );
    const user = result.data;
    requireCondition(
      isObject(user) &&
        user.tokenType === "user" &&
        nonEmpty(user.token) &&
        (user.id === expectedPersonId ||
          user.unique === credential ||
          String(user.distinguishedName || "").endsWith(
            `@${credential}@P`,
          )),
      "EXPECTED_DEDICATED_NORMAL_USER_IDENTITY",
    );
    return user;
  }

  async function listTasks(token, completed) {
    const result = await request(
      surface,
      `${completed ? "taskcompleted" : "task"}/v2/list/paging/1/size/100`,
      token,
      "POST",
      completed
        ? { key: title, latest: false }
        : { key: title, isExcludeDraft: true },
    );
    requireCondition(
      Array.isArray(result.data) &&
        Number.isSafeInteger(result.count) &&
        result.count >= 0 &&
        result.count <= 100,
      "INVALID_OR_UNEXPECTEDLY_LARGE_TEST_TASK_LIST",
    );
    return result.data;
  }

  function isKnownRow(row) {
    return (
      isObject(row) &&
      row.title === title &&
      row.application === applicationId &&
      row.process === processId
    );
  }

  function hasSeededBusinessData(data) {
    return (
      isObject(data) &&
      data.integrationMarker === title &&
      data.note === "独立测试库中的合成业务数据"
    );
  }

  step = "authenticate-normal-accounts";
  const policy = await request(
    "organization_assemble_authentication",
    "authentication/captchaRSAPublicKey",
    "",
  );
  requireCondition(
    isObject(policy.data) && policy.data.rsaEnable === false,
    "SCRIPT_REQUIRES_ISOLATED_NON_RSA_TEST_LOGIN",
  );
  const userA = await login(
    `oa_it_a_${seed.suffix}`,
    seed.passwordA,
    seed.ids.personA,
  );
  const userB = await login(
    `oa_it_b_${seed.suffix}`,
    seed.passwordB,
    seed.ids.personB,
  );
  receipt.checks.normalAccountsAuthenticated = true;

  step = "inspect-existing-pending-or-completed";
  const [pendingBefore, completedBefore] = await Promise.all([
    listTasks(userB.token, false),
    listTasks(userB.token, true),
  ]);
  const knownPending = pendingBefore.find(
    (row) =>
      isKnownRow(row) && row.id === knownTaskId && row.work === knownWorkId,
  );
  const alreadyDone = completedBefore.find(
    (row) =>
      isKnownRow(row) &&
      row.task === knownTaskId &&
      row.activity === seed.definitionIds.manualB &&
      row.routeName === "同意" &&
      nonEmpty(row.completedTime),
  );
  requireCondition(
    knownPending || alreadyDone,
    "KNOWN_B_TASK_NEITHER_PENDING_NOR_COMPLETED",
  );
  requireCondition(
    !readOnly || alreadyDone,
    "READ_ONLY_REQUIRES_PREVIOUSLY_COMPLETED_APPROVAL",
  );
  let jobId = String((knownPending || alreadyDone).job || "");
  requireCondition(nonEmpty(jobId), "KNOWN_WORK_JOB_ID_MISSING");
  receipt.jobId = jobId;
  receipt.alreadyCompleted = Boolean(alreadyDone && !knownPending);

  if (knownPending && !readOnly) {
    step = "read-real-task-and-route";
    const task = (
      await request(
        surface,
        `task/${encodeURIComponent(knownTaskId)}`,
        userB.token,
      )
    ).data;
    requireCondition(
      isKnownRow(task) &&
        task.id === knownTaskId &&
        task.work === knownWorkId &&
        task.job === jobId &&
        task.activity === seed.definitionIds.manualB &&
        task.person === userB.distinguishedName &&
        Array.isArray(task.routeList) &&
        task.routeList.length > 0 &&
        task.routeList.length <= 10,
      "REAL_TASK_DOES_NOT_MATCH_KNOWN_B_APPROVAL",
    );
    receipt.checks.knownAssigneePendingConfirmed = true;
    const routes = [];
    for (const routeId of task.routeList) {
      requireCondition(nonEmpty(routeId), "REAL_TASK_ROUTE_ID_INVALID");
      routes.push(
        (
          await request(
            surface,
            `route/${encodeURIComponent(routeId)}`,
            userB.token,
          )
        ).data,
      );
    }
    const approvalRoutes = routes.filter(
      (route) =>
        isObject(route) &&
        route.name === "同意" &&
        route.id === seed.definitionIds.route2 &&
        route.activityType === "end" &&
        route.activity === seed.definitionIds.end,
    );
    requireCondition(
      approvalRoutes.length === 1,
      "EXPECTED_REAL_APPROVAL_ROUTE_TO_TEST_END",
    );
    const selectedRoute = approvalRoutes[0];
    receipt.checks.realApprovalRouteConfirmed = true;
    receipt.selectedRoute = {
      id: selectedRoute.id,
      name: selectedRoute.name,
      targetType: selectedRoute.activityType,
    };

    const businessData = (
      await request(
        surface,
        `data/work/${encodeURIComponent(knownWorkId)}`,
        userB.token,
      )
    ).data;
    requireCondition(
      hasSeededBusinessData(businessData),
      "PENDING_WORK_BUSINESS_DATA_OR_CHINESE_NOTE_MISMATCH",
    );
    receipt.checks.businessDataBeforeApprovalConfirmed = true;

    const submittedByA = (await listTasks(userA.token, true)).find(
      (row) =>
        isKnownRow(row) &&
        row.job === jobId &&
        row.activity === seed.definitionIds.manualA &&
        row.routeName === "提交" &&
        nonEmpty(row.completedTime),
    );
    requireCondition(
      submittedByA,
      "REQUESTER_SUBMISSION_NOT_CONFIRMED_BEFORE_APPROVAL",
    );
    receipt.checks.requesterSubmissionCompleted = true;
    receipt.requesterCompletedTaskId = submittedByA.id;
    await saveReceipt();

    step = "submit-known-b-approval";
    await request(
      surface,
      `task/${encodeURIComponent(knownTaskId)}/processing`,
      userB.token,
      "POST",
      {
        routeName: selectedRoute.name,
        opinion: "专用隔离库真实联调：同意结束测试流程。",
      },
    );
    // An ActionProcessing 200 response is not proof: asynchronous processing can
    // return an empty result after an internal failure. Verify persisted state.
    receipt.submittedDuringThisRun = true;
    receipt.submittedAt = new Date().toISOString();
    await saveReceipt();
  }

  step = readOnly
    ? "recheck-persisted-completion"
    : "verify-persisted-completion";
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const [pendingB, completedB, completedA] = await Promise.all([
      listTasks(userB.token, false),
      listTasks(userB.token, true),
      listTasks(userA.token, true),
    ]);
    const doneB = completedB.find(
      (row) =>
        isKnownRow(row) &&
        row.job === jobId &&
        row.task === knownTaskId &&
        row.activity === seed.definitionIds.manualB &&
        row.routeName === "同意" &&
        nonEmpty(row.completedTime),
    );
    const doneA = completedA.find(
      (row) =>
        isKnownRow(row) &&
        row.job === jobId &&
        row.activity === seed.definitionIds.manualA &&
        row.routeName === "提交" &&
        nonEmpty(row.completedTime),
    );
    const noPendingB = !pendingB.some(
      (row) => isKnownRow(row) && (row.id === knownTaskId || row.job === jobId),
    );
    Object.assign(receipt.checks, {
      requesterSubmissionCompleted: Boolean(doneA),
      assigneePendingRemoved: noPendingB,
      assigneeApprovalCompleted: Boolean(doneB),
    });
    if (doneB && doneA && noPendingB) {
      const result = (
        await request(
          surface,
          `job/${encodeURIComponent(jobId)}/find/work/workcompleted`,
          userB.token,
        )
      ).data;
      requireCondition(
        isObject(result) &&
          Array.isArray(result.workList) &&
          Array.isArray(result.workCompletedList),
        "INVALID_JOB_COMPLETION_RESULT",
      );
      receipt.checks.noActiveWorkForJob = result.workList.length === 0;
      const completedWork = result.workCompletedList.find(
        (work) => isKnownRow(work) && work.job === jobId && nonEmpty(work.id),
      );
      if (receipt.checks.noActiveWorkForJob && completedWork) {
        const metadata = (
          await request(
            surface,
            `workcompleted/${encodeURIComponent(completedWork.id)}`,
            userB.token,
          )
        ).data;
        requireCondition(
          isKnownRow(metadata) &&
            metadata.id === completedWork.id &&
            metadata.job === jobId &&
            nonEmpty(metadata.completedTime),
          "COMPLETED_WORK_METADATA_NOT_CONFIRMED",
        );
        receipt.checks.completedWorkMetadataConfirmed = true;
        const completedBusinessData = (
          await request(
            surface,
            `data/workcompleted/${encodeURIComponent(metadata.id)}`,
            userB.token,
          )
        ).data;
        requireCondition(
          hasSeededBusinessData(completedBusinessData),
          "COMPLETED_WORK_BUSINESS_DATA_OR_CHINESE_NOTE_MISMATCH",
        );
        receipt.checks.completedBusinessDataConfirmed = true;
        receipt.checks.chineseBusinessDataConfirmed = true;
        Object.assign(receipt, {
          status: "passed",
          completedAt: new Date().toISOString(),
          workCompletedId: metadata.id,
          workCompletedTime: metadata.completedTime,
          workflowEnded: true,
          assigneeCompletedTaskId: doneB.id,
          requesterCompletedTaskId: doneA.id,
          completedTaskReferencesKnownPending: doneB.task === knownTaskId,
          persistenceRecheckedWithoutWorkflowWrite: readOnly,
          businessDataKeysVerified: ["integrationMarker", "note"],
        });
        await saveReceipt();
        console.log(
          JSON.stringify({
            status: receipt.status,
            mode: receipt.mode,
            submittedDuringThisRun: receipt.submittedDuringThisRun,
            workflowEnded: true,
            receipt: relative(projectRoot, receiptPath).split(sep).join("/"),
            credentialsPrinted: false,
          }),
        );
        return;
      }
    }
    await delay(1000);
  }
  throw new VerificationFailure("PERSISTED_WORKFLOW_COMPLETION_TIMEOUT");
}

try {
  await main();
} catch (error) {
  Object.assign(receipt, {
    status: "failed",
    failedAt: new Date().toISOString(),
    failedStep: step,
    errorCode:
      error instanceof VerificationFailure
        ? error.code
        : "LOCAL_VERIFICATION_FAILURE",
  });
  try {
    await saveReceipt();
  } catch {
    /* Never print a private path or raw I/O error. */
  }
  console.error(
    JSON.stringify({
      status: "failed",
      step,
      errorCode: receipt.errorCode,
      credentialsPrinted: false,
    }),
  );
  process.exitCode = 1;
}
