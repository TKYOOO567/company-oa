# ADR 0002：Web 第一版与模块边界

- 日期：2026-10-24，Asia/Shanghai。
- 状态：采用并按员工交互反馈更新；最小 MWF 字段与独立 MariaDB 真实联调通过，本轮交互的实际检查见单独记录，原生表单完整兼容仍待验证。
- 关联：REQ-007～REQ-011、ADR 0001；不修改已确认的全量替换目标。

## 授权与本轮范围

用户已同意开始开发，并要求先做 Web、模块化、第一版运行及测试通过后结束本轮。数据库暂定 MariaDB，测试时可自行启动本机服务。历史会计、公司共享和旧流程的待确认项继续保留，不用测试样例补成业务规则。

初版实现连接与账号、工作台基础、待办与已办、搜索分页、只读摘要及原生表单入口。用户后续要求先形成员工旅程，再补齐可操作的基本 OA 路径。当前实现独立登录壳、任务导航、真实授权流程与发起身份、显式创建、草稿保存恢复入口、我发起的与个人已办、摘要及流转记录、原生动态表单衔接和返回刷新。交互基线见[员工旅程](../../ux/01-employee-journey.md)，当前结果见[交互验证](../../verification/web-interactions.md)。客户、资金、完整会计及迁移仍按原改造方案推进，建设说明不代表业务已经实现。

## 前端与模块组织

采用 Vue 3、TypeScript、Vite，独立于上游 Gulp。官方 [Vue 快速开始](https://vuejs.org/guide/quick-start.html) 使用基于 Vite 的单页应用；[TypeScript 指南](https://vuejs.org/guide/typescript/overview) 提供类型检查方式。本工程锁定实际安装版本并提交 `package-lock.json`，Node 基线为 24.12+ 的 24 系列。

选型依据是员工页面与 API 适配可独立开发、仓库已有 Vue 使用经验依据，以及本版的类型检查和浏览器验证。它不证明 Vue 可以直接执行 MWF 动态表单脚本，也不取代原 ADR 的运行时兼容验证。

| 模块                                 | 责任                                               | 修改边界                                                         |
| ------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/oa-web/src/views/`             | 独立登录与账号、工作台、审批、应用目录             | 页面只调用工作区操作，不直接写 HTTP 或处理 token                 |
| `apps/oa-web/src/components/`        | 申请列表、详情抽屉、发起对话框与图标               | 复用展示、焦点与键盘、加载、空态及恢复操作                       |
| `apps/oa-web/src/state/workspace.ts` | 会话、模式、独立分类与搜索分页、创建及返回刷新状态 | 清理过期记录，忽略旧请求结果，阻止当前重复创建；不承担服务端授权 |
| `apps/oa-web/src/api/http.ts`        | 超时、原生 token、cookie、响应信封与错误           | 不把 HTTP 200 的逻辑失败当成功                                   |
| `apps/oa-web/src/api/o2oa.ts`        | 源码核对后的 O2OA 契约映射                         | 不向页面泄露平台原始结构，不调用管理员接口                       |
| `apps/oa-web/src/api/demo.ts`        | 人工示例适配器                                     | 用户主动进入，不能访问真实平台或执行审批                         |
| `apps/oa-web/src/types.ts`           | 页面与适配器之间的类型契约                         | 通过统一接口替换数据来源                                         |
| `deployment/dev/`                    | 隔离平台环境检查                                   | 与员工 UI 解耦，不安装全局服务或改现有数据库                     |

## 接入、会话与表单

浏览器通过同源 `/o2-api/auth`、`/o2-api/process` 接入，开发代理映射实际 O2OA 服务；生产反向代理需另行部署。未配置服务时明确报错，不猜测端口、不自动进入演示。适配器只在闭包内存维护 token，不额外保存到本地存储或 URL；认证 cookie 仍按平台服务器的机制工作。

账号密码及 RSA 按平台现有契约处理；不支持的双因素或非密码登录方式明确返回原平台登录提示。是否采用该方式作为生产登录仍属 OPEN-003。

当前只读元数据详情使用普通用户工作接口。完整表单以新页打开 O2OA 原生页面，URL 不附自动执行 action 或 token。已实测普通账号跨端口复用平台 Cookie、打开同一工作、MWF Textfield 绑定后端中文数据；仍不代表附件、复杂脚本、字段权限和全部旧表单兼容。

发起目录和可用身份从普通账号的真实服务加载。用户明确选择标题与身份后才创建申请；按流程配置承接草稿或实例启动。草稿以服务端草稿标识保存并恢复，不向 URL 填入整份业务数据；在途追踪可由原生运行页处理并行工作的选择，不在前端静默挑一个分支。创建请求超时或结果无法确认时不自动重放，界面要求先核对草稿箱与我发起的。

表单打开后持续跟踪返回：窗口重新获得焦点或恢复可见时重新读取列表与有效详情；中途查看新 Web 不结束跟踪。用户点击完成刷新并成功读取后才结束本次跟踪；原草稿或任务已离开当前分类时关闭过期详情。新 Web 不根据窗口打开或 HTTP 200 断言审批成功。

认证模式及公钥来自 [ActionMode](../../../o2server/x_organization_assemble_authentication/src/main/java/com/x/organization/assemble/authentication/jaxrs/authentication/ActionMode.java) 和 [RSA 公钥接口](../../../o2server/x_organization_assemble_authentication/src/main/java/com/x/organization/assemble/authentication/jaxrs/authentication/ActionCaptchaRSAPublicKey.java)；原始 token 的解析依据 [HttpToken](../../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/http/HttpToken.java)。待办、已办分页分别对应 [task V2ListPaging](../../../o2server/x_processplatform_assemble_surface/src/main/java/com/x/processplatform/assemble/surface/jaxrs/task/V2ListPaging.java) 与 [taskcompleted V2ListPaging](../../../o2server/x_processplatform_assemble_surface/src/main/java/com/x/processplatform/assemble/surface/jaxrs/taskcompleted/V2ListPaging.java)。这些是静态契约依据，测试响应不能替代运行中的平台。

账号转换会推进 HTTP 层会话版本并取消旧请求，旧响应不能覆盖新账号 token。任务数据请求仅携带原始 token，忽略 cookie，防止旧数据响应写回旧身份 cookie；公开策略请求不携带身份。登录、当前会话及退出仍保留平台 cookie 机制。

公司与金额字段在目标业务映射核实前不从部门名或其他字段猜测；已办只表示当前用户办理记录，不表示整个流程结束。列表与详情仍由平台服务端检查当前用户权限。

草稿、当前待办、创建者追踪和个人已办是四种独立查询语义。未提交草稿不拼入创建者追踪分页，个人已办同时显示工作是否已经结束。403 拒绝保留会话并给出错误；401 或明确的平台会话失效清空身份及旧数据，返回独立登录页。前端筛选和身份选择不会授予额外权限。

## MariaDB

按用户最新要求，数据库暂定 MariaDB。Web 通过平台服务访问数据，不直接持有数据库账号。第一版前端不为通过测试而内置另一套数据库或将人工示例写入现有库。

本机 JDK 11、MySQL Connector/J 8.4.0、OpenJPA 3.2.2 与 MariaDB 12.3.2 已在独立实例及新建库实际验证建表、审批持久化、中文及四字节字符、索引完整值比较和事务回滚，详见[平台运行验证](../../verification/platform-runtime.md)。必要源码修复登记 PATCH-0001/0002；生产容量、其他数据库版本及业务财务规则仍需对应验收。

## 验证边界

初版平台接入检查保留在 [Web 第一版历史验证](../../verification/web-v0.1.md)。当前独立登录、发起、草稿、追踪与返回刷新实现的类型检查、生产构建、单元／契约、受控 Chrome 及真实旅程结果分别记录在[交互验证](../../verification/web-interactions.md)。契约测试使用测试响应，演示仅含合成数据；这些检查不能代替完整 O2OA、MariaDB、原流程或公司授权验收。
