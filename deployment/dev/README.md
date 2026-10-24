# 本机开发环境预检

本目录工具用于 Windows / PowerShell 7，提供环境预检、便携工具链、隔离源码构建及真实联调工具。详细实测结果见[平台运行报告](../../docs/verification/platform-runtime.md)。所有实际发布包、运行配置、数据库材料和日志放在工程内忽略目录 `.local/`；不安装全局 Java/Maven，不修改已有数据库服务。

从工程根目录运行：

```powershell
pwsh -NoProfile -File deployment/dev/Test-O2Platform.ps1
pwsh -NoProfile -File deployment/dev/Test-MariaDb.ps1
```

第一个脚本输出工具存在性、Node/npm 版本、Docker 引擎状态、物理内存、源码模块及已编译产物数量，以及指定发布目录的最小结构检查。默认发布目录为 `.local/runtime/o2server`；可以用 `-RuntimeRoot` 指定另一份完整包目录。文件存在不代表版本兼容、依赖完整或能够启动。

`Inspect` 模式退出 0 只表示诊断执行完成，必须阅读 `structuralMinimumPresent`、`requiredBuildToolsPresent` 等字段；不能将退出 0 当作平台运行通过。

真实隔离平台启动且端口已确认后，执行 HTTP 探测。以下 18080 仅为示例端口，需要替换成实际配置：

```powershell
pwsh -NoProfile -File deployment/dev/Test-O2Platform.ps1 -Mode Probe `
  -WebBaseUri http://127.0.0.1:18080/ `
  -ApplicationBaseUri http://127.0.0.1:18080/
```

探测仅发无凭证 GET，请求不经过代理、不跟随重定向，不记录响应正文。只接受 loopback 地址。它分别识别平台 HTML 特征和 `authentication/mode` 的成功响应形状；任一未通过时退出 2。即使通过，也只证明指定端点可达且响应形状符合预期，尚不能证明登录、流程、权限、数据库或业务验收通过。当前源码三个 HTTP 默认值均为 80，但最终地址以实际运行配置和服务发现为准，不强制沿用旧说明中的 20020／20030。

MariaDB 的以下命令可在用户已授权启动服务时使用；它不会自动提权，不修改服务启动类型，不启动第二个数据库实例：

```powershell
pwsh -NoProfile -File deployment/dev/Test-MariaDb.ps1 -StartService -RequireRunning
```

脚本读取注册服务的程序及配置路径、版本、端口，并核对监听进程是否属于该服务；不猜测凭据、不登录、不建库、不执行 SQL，也不输出密码值。`-RequireRunning` 下服务与端口未确认时退出 2。先前启动失败及用户后续自行开启的状态见报告。

## 隔离源码构建

用户后续已授权真实平台联调所需下载和本仓库源码构建。以下工具不启动 O2OA、不访问数据库、不修改系统 PATH 或全局安装目录：

```powershell
pwsh -NoProfile -File deployment/dev/Get-O2Dependencies.ps1
pwsh -NoProfile -File deployment/dev/Build-O2Source.ps1 -Stage Server
```

`Get-O2Dependencies.ps1` 把 Maven、上游准备脚本指定的 commons 与 Windows Java11 归档下载到 `.local/runtime/downloads/`，解压到 `toolchains/`。Maven 3.9.11 归档与发布方 SHA512 校验；O2 两份归档没有使用发布方摘要，记录实际下载内容 SHA256/SHA512。JVM 地址中的 `master` 会变化，复现时应保留归档及其摘要，不能将可变 URL 本身当成版本锁。脚本可用 `-Component Maven`、`Jvm` 或 `Commons` 单独准备组件；不会下载其他 O2OA 大版本发布包代替源码构建。

`Build-O2Source.ps1` 将本仓库实际工作树复制到 `.local/runtime/source-build/` 的独立快照。`source-manifest.json` 记录 Git 提交、工作树差异、Git blob 清单摘要和修改／新增源文件的实际 SHA256，生成代码、依赖缓存与构建日志均留在该忽略目录。Maven 使用便携 JDK 和 1 GiB 最大堆；只修改子进程环境，结束后恢复。源码默认跳过测试的行为保留，`Server` 成功不能称为测试已通过。

取得 `SOURCE_BUILD_ROOT` 后继续执行，`$snapshotRoot` 使用上一步实际返回的目录：

```powershell
$snapshotRoot = '上一步返回的 SOURCE_BUILD_ROOT'
pwsh -NoProfile -File deployment/dev/Build-O2Source.ps1 -Stage CoreTest -BuildRoot $snapshotRoot
pwsh -NoProfile -File deployment/dev/Build-O2Source.ps1 -Stage Web -BuildRoot $snapshotRoot
pwsh -NoProfile -File deployment/dev/Build-O2Source.ps1 -Stage Assemble -BuildRoot $snapshotRoot
```

`CoreTest` 显式执行 `ExternalDataSourcesTest`，要求 Surefire XML 中执行数大于零且无失败。`Web` 使用该快照内上游构建脚本；`Assemble` 将实际源码产物与下载的运行依赖整理到快照内 `target/o2server/`。每阶段仅在成功后生成对应 receipt；失败保留日志，不把部分产物标为完整运行包。目标目录存在和构建完成均不代表平台启动、MariaDB JDBC 或端到端业务联调通过，这些仍由真实运行验证确认。

## 真实隔离联调

2026-10-24 实测有效环境为 `.local/runtime/o2server-it-clean/`，独立库配置为 `.local/secrets/mariadb-integration-clean.json`，凭据仅在私有文件。已完成的流程可在 Web 的“我的已办”中查看；该环境恢复时使用 Resume 路径，不能重新 Initialize 或 Seed。旧 `.local/runtime/o2server-it/` 是首次索引失败的诊断环境，已退出；不要同时启动占用相同端口。

以下步骤会创建合成组织、普通测试账号、MWF 表单和两节点流程，只能用于专用测试环境。无需已有 3306 服务的管理员密码：`Start-IsolatedMariaDb.ps1` 使用本机已安装程序，在 `.local/runtime/mariadb-integration/` 初始化全新数据目录、随机管理员密码，并仅监听 127.0.0.1:13306，不注册 Windows 服务、不改变既有服务。

首次准备（已有目录/配置时脚本拒绝覆盖；不要重复初始化）：

```powershell
pwsh -NoProfile -File deployment/dev/Start-IsolatedMariaDb.ps1
pwsh -NoProfile -File deployment/dev/New-IntegrationDatabase.ps1 `
  -AdminConfig .local/secrets/mariadb-isolated-admin.json
```

也可向建库脚本提供明确授权的现有本机实例配置，格式为 `host`、`port`、`user`、`password`；只能使用 127.0.0.1。不要在命令行或聊天中填写密码。建库脚本生成全新 `companyoait<日期><随机后缀>` 库及 `oa_it_<后缀>` 专用账号，只授予该库权限，验证不能读取系统用户表。SQL 通过标准输入执行，临时客户端凭据文件在操作后清空。

源码发生本项目的控制台修复后，在原快照重新同步并测试：

```powershell
pwsh -NoProfile -File deployment/dev/Build-O2Source.ps1 -Stage Console `
  -BuildRoot $snapshotRoot -ConsoleTest ResourceFactoryDataSourcesTest
pwsh -NoProfile -File deployment/dev/Build-O2Source.ps1 -Stage CoreBuild -BuildRoot $snapshotRoot
pwsh -NoProfile -File deployment/dev/Build-O2Source.ps1 -Stage Assemble -BuildRoot $snapshotRoot
```

把 Assemble 产物完整复制到新的 `.local/runtime/o2server-it/`；不要覆盖已有配置或正在运行的目录。随后从工程根目录执行：

```powershell
$runtimeRoot = Join-Path (Get-Location) '.local/runtime/o2server-it'
$javaHome = Join-Path $runtimeRoot 'jvm/windows_java11'
pwsh -NoProfile -File deployment/dev/Initialize-O2IntegrationEnvironment.ps1 -RuntimeRoot $runtimeRoot
pwsh -NoProfile -File deployment/dev/Start-O2Integration.ps1 -RuntimeRoot $runtimeRoot -JavaHome $javaHome
pwsh -NoProfile -File deployment/dev/Wait-O2Integration.ps1 -RuntimeRoot $runtimeRoot
```

启动脚本输出 starting 仅表示已创建进程。Wait 要求当前 PID 的三个端口、应用及 Web 启动完成标志、Web HTML 和认证模式响应均符合预期；最早可达的认证端点不足以证明内部服务已注册。HTTP 分别为 18080/18020/18030，均须本机回环，并另行核对该 PID 无 UDP；节点代理、内置 H2、FTP、定时备份和测试通知消费通道关闭。JVM 初始堆 256 MiB、最大 1280 MiB、4 个可见处理器，仅为本机隔离验证配置。测试实例关闭短信/绑定登录与首次强制改密，并使用仅供合成标识的手机号正则；这些设置不能作为生产账号策略。

服务可用后运行 `Seed-O2Integration.mjs <runtimeRoot>`。该脚本只为首次联调创建配置和一条已由 A 提交给 B 的真实待办。`.local/live-integration.json` 保存测试账号，不进入 Git。流程完成后不要重新运行 seed；恢复现有环境使用下面的 Resume 路径。

按 `apps/oa-web/.env.example` 设置忽略文件 `.env.local`：两个后端 origin 均为 `http://127.0.0.1:18020`，原生 Web 为 `http://127.0.0.1:18080`，浏览器统一使用 127.0.0.1。先启动新 Web，然后执行：

```powershell
pwsh -NoProfile -File deployment/dev/Test-IntegrationDatabase.ps1 -RuntimeRoot $runtimeRoot -Stage Pending
pwsh -NoProfile -File deployment/dev/Test-MariaDbIndex.ps1 -RuntimeRoot $runtimeRoot
# 在 apps/oa-web 内，显式启用真实 Chrome 测试；不启动服务、不使用演示/请求模拟
$env:OA_LIVE_E2E = '1'
$env:OA_LIVE_STAGE = 'pending'
npm run test:e2e:live
# 回到工程根目录，浏览器检查通过后才实际办理已知合成审批
node deployment/dev/Verify-O2Workflow.mjs $runtimeRoot
pwsh -NoProfile -File deployment/dev/Test-IntegrationDatabase.ps1 -RuntimeRoot $runtimeRoot -Stage Completed
```

数据库核对从 MariaDB 实表读取已知任务/工作的计数，并要求存在其他专用账号连接；不是仅检查配置。流程核对要求双方已办、整条流程结束及中文业务数据回读，不以 HTTP 200 代替成功。原生浏览器检查要求 MWF 字段绑定真实后端数据；不代表附件、复杂脚本和旧流程全部验收。

正常停止和持久化重启（保留原数据及凭据）：

```powershell
pwsh -NoProfile -File deployment/dev/Stop-O2Integration.ps1 -RuntimeRoot $runtimeRoot
pwsh -NoProfile -File deployment/dev/Stop-IsolatedMariaDb.ps1
pwsh -NoProfile -File deployment/dev/Start-IsolatedMariaDb.ps1 -Resume
pwsh -NoProfile -File deployment/dev/Start-O2Integration.ps1 -RuntimeRoot $runtimeRoot -JavaHome $javaHome
pwsh -NoProfile -File deployment/dev/Wait-O2Integration.ps1 -RuntimeRoot $runtimeRoot
node deployment/dev/Verify-O2Workflow.mjs $runtimeRoot --read-only
pwsh -NoProfile -File deployment/dev/Test-IntegrationDatabase.ps1 -RuntimeRoot $runtimeRoot -Stage Completed
```

停止工具先核对 PID、程序、配置和端口归属，再发送平台 exit 或 SQL SHUTDOWN；不会强杀未知进程。密码、token、运行日志和回执均留在 `.local/`，公开报告只记录版本、测试结论和必要限制。已有 3306 服务不随这些命令启动、停止或改配置。

当前环境恢复前将 `$runtimeRoot` 设为 `.local/runtime/o2server-it-clean/` 的绝对路径。重启后在 Web 工程内设置 `OA_LIVE_STAGE=completed` 运行同一 live 命令，可复查已办。

`Test-MariaDbIndex.ps1` 先检查实际索引、列长度和 utf8mb4，再在事务中插入两个仅索引前缀相同的合成行，核对完整值、四字节字符并回滚。它不会修改列或建立替代索引。第一次失败后留下的缺索引表不作为成功证据；本次在第二个全新库从零完成验证。

源码同步可用 `Sync-O2ConsoleSource.ps1 -Module x_base_core_project -BuildRoot <snapshot>`（控制台为默认模块），更新来源清单后再做对应增量构建；工具不会自动同步新 Web 业务代码。`Test-O2SourceArtifacts.ps1 -BuildRoot <snapshot> -RuntimeRoot <实际运行目录>` 对 console、29 WAR、25 shared JAR 和必要原生资产做只读核对。

诊断使用 `Read-O2IntegrationLog.ps1 -RuntimeRoot <runtime>`，不要直接输出私有平台日志。平台异常记录可能包含认证头；本工具先遮蔽已知私密值及认证/Cookie/token字段。`Revoke-O2TestSession.mjs` 仅用于本次已捕获测试会话的安全注销检查，不能作为普通生产退出入口；真实生产日志脱敏和会话策略仍需专门处理。

本轮员工旅程使用 `Seed-O2UxIntegration.mjs <runtimeRoot>` 准备独立的合成应用、可编辑 MWF 字段、系统操作栏和 A→B 草稿流程。该工具读取已有专用测试账号，仅创建定义，不提前创建工作；真实申请由 Web 浏览器创建。它保留自己的定义回执并复用，不更改上一轮已完成工作。私有配置写在项目 `.local/ux-live-integration.json`，不输出凭据。

保持一个独立终端持续运行 Web 开发服务，再启动真实旅程测试：

```powershell
# 在 apps/oa-web 中持续运行，端口已被占用时明确失败
npm run dev -- --strictPort
# 在另一个终端的 apps/oa-web 中运行
$env:OA_UX_LIVE_E2E = '1'
npx playwright test --config playwright.ux-live.config.ts
Remove-Item Env:OA_UX_LIVE_E2E
```

真实旅程配置没有自动托管开发服务，使用中文 Chrome，不拦截请求，禁用截图、trace 和视频；安全回执位于 `.local/ux-live-e2e-results/journey-receipt.json`。默认受控 E2E 与真实旅程顺序执行，避免测试自动启动及退出开发服务时打断另一个验证过程。当前结果见[员工交互验证](../../docs/verification/web-interactions.md)。
