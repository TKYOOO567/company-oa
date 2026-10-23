# ADR 0002：Web 第一版与模块边界

- 日期：2026-10-24，Asia/Shanghai。
- 状态：本轮采用；O2OA 原生表单完整兼容及数据库联调仍待验证。
- 关联：REQ-007～REQ-011、ADR 0001；不修改已确认的全量替换目标。

## 授权与本轮范围

用户已同意开始开发，并要求先做 Web、模块化、第一版运行及测试通过后结束本轮。数据库暂定 MariaDB，测试时可自行启动本机服务。历史会计、公司共享和旧流程的待确认项继续保留，不用测试样例补成业务规则。

第一版实现连接与账号页面、岗位工作台基础、当前用户待办和已办列表、服务器搜索和分页、只读审批摘要及原生表单入口。客户、资金、完整会计及迁移仍按原改造方案推进，本版不建立其虚假业务能力。

## 前端与模块组织

采用 Vue 3、TypeScript、Vite，独立于上游 Gulp。官方 [Vue 快速开始](https://vuejs.org/guide/quick-start.html) 使用基于 Vite 的单页应用；[TypeScript 指南](https://vuejs.org/guide/typescript/overview) 提供类型检查方式。本工程锁定实际安装版本并提交 `package-lock.json`，Node 基线为 24.12+ 的 24 系列。

选型依据是员工页面与 API 适配可独立开发、仓库已有 Vue 使用经验依据，以及本版的类型检查和浏览器验证。它不证明 Vue 可以直接执行 MWF 动态表单脚本，也不取代原 ADR 的运行时兼容验证。

| 模块 | 责任 | 修改边界 |
| --- | --- | --- |
| `apps/oa-web/src/views/` | 工作台、审批、连接、应用状态页面 | 页面只调用工作区操作，不直接写 HTTP 或处理 token |
| `apps/oa-web/src/components/` | 列表、详情抽屉、图标 | 复用展示、键盘操作、加载和空态 |
| `apps/oa-web/src/state/workspace.ts` | 会话、模式、搜索分页、并发请求与页面状态 | 清理过期记录，忽略旧请求结果；不承担服务端授权 |
| `apps/oa-web/src/api/http.ts` | 超时、原生 token、cookie、响应信封与错误 | 不把 HTTP 200 的逻辑失败当成功 |
| `apps/oa-web/src/api/o2oa.ts` | 源码核对后的 O2OA 契约映射 | 不向页面泄露平台原始结构，不调用管理员接口 |
| `apps/oa-web/src/api/demo.ts` | 人工示例适配器 | 用户主动进入，不能访问真实平台或执行审批 |
| `apps/oa-web/src/types.ts` | 页面与适配器之间的类型契约 | 通过统一接口替换数据来源 |
| `deployment/dev/` | 隔离平台环境检查 | 与员工 UI 解耦，不安装全局服务或改现有数据库 |

## 接入、会话与表单

浏览器通过同源 `/o2-api/auth`、`/o2-api/process` 接入，开发代理映射实际 O2OA 服务；生产反向代理需另行部署。未配置服务时明确报错，不猜测端口、不自动进入演示。适配器只在闭包内存维护 token，不额外保存到本地存储或 URL；认证 cookie 仍按平台服务器的机制工作。

账号密码及 RSA 按平台现有契约处理；不支持的双因素或非密码登录方式明确返回原平台登录提示。是否采用该方式作为生产登录仍属 OPEN-003。

当前只读元数据详情使用普通用户工作接口。完整表单暂以新页打开 O2OA 原生页面，URL 不附自动执行 action 或 token。这是第一版接入边界，尚未宣称原生表单、附件及审批全链路兼容已通过。

认证模式及公钥来自 [ActionMode](../../../o2server/x_organization_assemble_authentication/src/main/java/com/x/organization/assemble/authentication/jaxrs/authentication/ActionMode.java) 和 [RSA 公钥接口](../../../o2server/x_organization_assemble_authentication/src/main/java/com/x/organization/assemble/authentication/jaxrs/authentication/ActionCaptchaRSAPublicKey.java)；原始 token 的解析依据 [HttpToken](../../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/http/HttpToken.java)。待办、已办分页分别对应 [task V2ListPaging](../../../o2server/x_processplatform_assemble_surface/src/main/java/com/x/processplatform/assemble/surface/jaxrs/task/V2ListPaging.java) 与 [taskcompleted V2ListPaging](../../../o2server/x_processplatform_assemble_surface/src/main/java/com/x/processplatform/assemble/surface/jaxrs/taskcompleted/V2ListPaging.java)。这些是静态契约依据，测试响应不能替代运行中的平台。

账号转换会推进 HTTP 层会话版本并取消旧请求，旧响应不能覆盖新账号 token。任务数据请求仅携带原始 token，忽略 cookie，防止旧数据响应写回旧身份 cookie；公开策略请求不携带身份。登录、当前会话及退出仍保留平台 cookie 机制。

公司与金额字段在目标业务映射核实前不从部门名或其他字段猜测；已办只表示当前用户办理记录，不表示整个流程结束。列表与详情仍由平台服务端检查当前用户权限。

## MariaDB

按用户最新要求，数据库暂定 MariaDB。Web 通过平台服务访问数据，不直接持有数据库账号。第一版前端不为通过测试而内置另一套数据库或将人工示例写入现有库。

本机环境、服务启动尝试和平台 JDBC 兼容缺口见 [平台运行验证](../../verification/platform-runtime.md)。真正接库前应使用独立测试库核对平台驱动、建表、事务和中文字段；尚未做过的检查不得标为通过。

## 验证边界

类型检查、生产构建、HTTP 契约单测、状态并发测试和真实 Chrome 中的界面测试分别记录在 [Web 第一版验证](../../verification/web-v0.1.md)。契约测试使用测试响应，演示仅含合成数据；这些检查不能代替完整 O2OA、MariaDB、原流程或公司授权验收。
