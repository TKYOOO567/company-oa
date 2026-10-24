# 新 Web 业务前端

本目录是 Vue 3 + TypeScript + Vite 的独立员工 Web 工程。当前提供独立登录页、工作台、真实流程目录、按身份发起申请、草稿箱、待办、我发起的、个人已办、搜索分页与流转记录。完整表单在 O2OA 动态运行页中填写、保存和办理；新 Web 负责入口、摘要、追踪与返回刷新。

客户管理、资金流水、完整会计、多公司业务权限和历史迁移尚未验收。应用页的建设说明用于交代范围，不是这些模块已经完成的证明。本期仅做 Web，Android 后续另线推进。

参见[开发约束](../../AGENTS.md)、[员工旅程图](../../docs/ux/employee-journey.html)、[交互基线](../../docs/ux/01-employee-journey.md)、[本轮交互验证](../../docs/verification/web-interactions.md)与[改造方案](../../docs/architecture/02-o2oa-adaptation-plan.md)。

## 使用路径

1. 打开系统，连接与会话检测完成后登录。未登录时只显示登录入口，不显示无法进入的业务侧栏。
2. 在工作台处理待办，或进入“发起申请”选择当前账号有权使用的流程及发起身份。
3. 显式创建申请后打开对应表单填写。平台使用草稿启动模式时，可以保存、关闭，再从“草稿箱”恢复；草稿未提交时不进入“我发起的”审批追踪列表。
4. 在“我发起的”跟进当前节点与处理人，在“待我处理”办理，在“我的已办”查询本人的办理记录。个人已办和整条流程结束分别显示。
5. 打开表单后，新 Web 每次重新获得焦点会刷新列表。完成编辑或办理后，点击“已完成操作，刷新”结束本次返回跟踪；不要根据打开窗口或 HTTP 200 自行判断业务已办结。

403 无权限会保留登录会话并给出错误，401 会话失效回到独立登录页。创建请求的结果不确定时不会自动重放，应先核对“草稿箱”和“我发起的”，避免重复申请。

## 本地运行

使用 Node 24.12+（24 系列），在本目录运行：

```powershell
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。默认使用真实平台模式；没有服务配置时明确显示连接失败，可主动点击“查看界面演示”体验人工示例。演示不会登录真实平台、执行审批或写入数据库。

真实联调前，将 `.env.example` 复制为 `.env.local`，按隔离 O2OA 的实际服务地址设置 `OA_O2_AUTH_ORIGIN`、`OA_O2_PROCESS_ORIGIN` 和 `VITE_OA_PLATFORM_WEB_URL`，然后重启开发服务器。端口按实际配置取值，示例端口不是本 fork 的默认值声明。

`OA_` 配置供 Vite 开发代理读取；`VITE_` 配置会进入浏览器，不能放密码或 token。生产静态文件需配套同源反向代理；`npm run preview` 仅供构建预览，不自带开发代理。测试连接信息、账号和运行文件全部保存在忽略的 `.local/` 内，不提交到 Git。

## 模块边界

| 目录                     | 职责                                                 |
| ------------------------ | ---------------------------------------------------- |
| `src/views/`             | 登录与账号、工作台、审批列表、应用目录               |
| `src/components/`        | 申请表格、详情抽屉、发起对话框与图标                 |
| `src/state/workspace.ts` | 身份切换、加载与错误、搜索分页、发起和返回刷新状态   |
| `src/api/`               | HTTP 会话与错误、O2OA 业务契约、明确的人工演示适配器 |
| `src/styles/`            | 基础样式、独立登录布局、员工任务与应用交互样式       |
| `src/types.ts`           | 页面、状态和适配器之间的类型契约                     |

页面通过工作区操作调用适配器，不直接保存 token、拼接平台接口或连接数据库。列表可见性、发起身份、表单操作与公司业务权限由服务端检查，前端隐藏按钮不代替授权。

## 检查与真实联调

```powershell
npm test
npm run typecheck
npm run build
npm run test:e2e
```

默认 E2E 使用本机 Chrome 的隔离浏览器上下文，不读取日常 Chrome 登录资料。它使用显式演示或受控测试响应，不代表真实平台验证。若使用 Playwright 自带 Chromium，先运行 `npx playwright install chromium`，再设置 `OA_TEST_BROWSER_CHANNEL=chromium`。

本轮员工整链验证有独立入口，默认关闭，不拦截或模拟平台请求。它会在已核实的隔离环境中，用两个不同的普通测试账号，实际创建合成申请、保存和恢复草稿、提交与办理。配置必须位于本仓库 `.local/` 中，服务地址只接受无凭据的本机地址。准备过程见[运行工具](../../deployment/dev/README.md)，不要把测试指向公司业务库。

```powershell
# 在本目录执行，先准备 .local/ux-live-integration.json 和已启动的隔离服务
$env:OA_UX_LIVE_E2E = '1'
npx playwright test --config playwright.ux-live.config.ts
Remove-Item Env:OA_UX_LIVE_E2E
```

截图、trace 和视频在真实旅程配置中关闭；测试配置与报告保存在忽略目录。已存在的最小链路复查入口 `npm run test:e2e:live` 继续保留，需显式设置 `OA_LIVE_E2E=1`；使用 `OA_LIVE_STAGE=pending` 或 `completed` 必须与已知合成事项的实际状态一致，不用空列表代替成功。

本轮实现、实际检查和未验收范围以[交互验证记录](../../docs/verification/web-interactions.md)为准。平台源码、独立 MariaDB、重启持久化与工具链结果见[平台运行报告](../../docs/verification/platform-runtime.md)，技术边界见 [ADR 0002](../../docs/architecture/adr/0002-web-foundation.md)。
