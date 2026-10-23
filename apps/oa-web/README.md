# 新 Web 业务前端

本目录为 Vue 3 + TypeScript + Vite 的独立员工 Web 工程，当前版本 `0.1.0`。已实现平台连接、工作台、审批列表及只读详情基础；客户、资金、正式会计及历史迁移尚未接入。

- 通过统一适配层接入 O2OA 的认证、流程、表单、附件和查询接口。
- 动态表单、校验、联动脚本、字段权限与配置生效方式先做兼容性验证。
- 公司筛选和可见按钮用于展示；服务端负责真实数据授权。
- 管理员可视化设计能力优先复用；员工交互按岗位重新设计。
- 构建和包管理独立于上游根 Gulp 工程，选型后保留对应锁文件。
- 本期仅 Web；Android 后续另线推进。

参见 [开发约束](../../AGENTS.md)、[改造方案](../../docs/architecture/02-o2oa-adaptation-plan.md) 与 [验收计划](../../docs/verification/01-acceptance-plan.md)。

## 本地运行

Node 24.12+（24 系列），在本目录运行：

```powershell
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。默认使用真实平台模式；没有服务配置时显示未连接，可主动点击“查看界面演示”体验人工示例。演示不会登录真实平台、执行审批或写入数据库。

真实联调前，将 `.env.example` 复制为 `.env.local`，按隔离 O2OA 的实际服务地址设置 `OA_O2_AUTH_ORIGIN`、`OA_O2_PROCESS_ORIGIN` 和 `VITE_OA_PLATFORM_WEB_URL`，然后重启开发服务器。端口只按实际配置取值，示例端口并非本 fork 的确定默认值。

`OA_` 配置供 Vite 开发代理读取；`VITE_` 配置会进入浏览器，不能放密码或 token。生产静态文件需配套同源反向代理；`npm run preview` 仅供构建预览，不自带开发代理。

## 模块与检查

页面位于 `src/views/`，复用组件位于 `src/components/`，应用状态位于 `src/state/`，HTTP 与平台契约位于 `src/api/`，共用类型位于 `src/types.ts`。页面不直接保存 token、拼接平台接口或连接数据库。

```powershell
npm test
npm run build
npm run test:e2e
```

E2E 默认使用本机 Chrome 的隔离浏览器上下文，不读取日常 Chrome 登录资料。若使用 Playwright 自带 Chromium，先运行 `npx playwright install chromium`，再设置 `OA_TEST_BROWSER_CHANNEL=chromium`。E2E 使用显式演示及受控测试响应，不会请求真实公司账号。

真实接口契约、测试范围及当前缺口见 [Web 第一版验证](../../docs/verification/web-v0.1.md)、[ADR 0002](../../docs/architecture/adr/0002-web-foundation.md) 和[平台运行调查](../../docs/verification/platform-runtime.md)。
