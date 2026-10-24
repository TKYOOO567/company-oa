import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const local = join(project, ".local");
const runtime = resolve(process.argv[2] || "");
const captureOnly = process.argv.includes("--capture-only");
if (!runtime.startsWith(local + sep))
  throw new Error("Project-local runtime required.");
const file = join(runtime, "revocation-session.json");
const parse = async (path) =>
  JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
let session;
try {
  session = await parse(file);
} catch (error) {
  if (error.code !== "ENOENT")
    throw new Error("Private revocation configuration is unreadable.");
  const logs = await readFile(
    join(runtime, "local/integration-logs/stdout.log"),
    "utf8",
  );
  const matches = [...logs.matchAll(/head:Authorization:([^\s\r\n]+)/gi)];
  if (!matches.length) throw new Error("No private test session was captured.");
  session = { token: matches.at(-1)[1] };
  await writeFile(file, JSON.stringify(session), "utf8");
}
if (captureOnly) {
  console.log(
    JSON.stringify({ capturedPrivately: true, credentialsPrinted: false }),
  );
} else {
  const environment = await parse(
    join(runtime, "integration-environment.json"),
  );
  const seed = await parse(join(runtime, "integration-seed.json"));
  const config = await parse(join(runtime, "config/person.json"));
  if (config.enableSafeLogout !== true || environment.host !== "127.0.0.1")
    throw new Error("Isolated safe logout must be enabled.");
  async function request(path) {
    const response = await fetch(
      `http://127.0.0.1:${environment.applicationPort}/x_organization_assemble_authentication/jaxrs/authentication${path}`,
      {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: { "x-token": session.token, Authorization: session.token },
      },
    );
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Session check did not return JSON.");
    }
    if (!response.ok || payload.type !== "success")
      throw new Error("Session revocation request failed.");
    return payload.data;
  }
  const before = await request("");
  if (before.tokenType !== "anonymous") {
    if (
      before.unique !== `oa_it_a_${seed.suffix}` &&
      before.name !== `联调发起人-${seed.suffix}`
    )
      throw new Error("Captured session is not the dedicated requester.");
    await request("/safe/logout");
  }
  const after = await request("");
  if (after.tokenType !== "anonymous")
    throw new Error("The old session remains valid.");
  const receipt = {
    revoked: true,
    oldSessionAnonymous: true,
    checkedAt: new Date().toISOString(),
    credentialsPrinted: false,
  };
  await mkdir(join(local, "verification"), { recursive: true });
  await writeFile(
    join(local, "verification/test-session-revocation.json"),
    JSON.stringify(receipt, null, 2) + "\n",
    "utf8",
  );
  console.log(JSON.stringify(receipt));
}
