# O2OA 独立数据库联调：源码核对说明

记录日期：2026-10-24，Asia/Shanghai。关联 [文档入口](../README.md)、[平台运行调查](platform-runtime.md)、[Web 第一版](web-v0.1.md) 和 [验收计划](01-acceptance-plan.md)。

本文件记录本仓库源码契约、脱敏配置模板与最小烟测方法。**本文件不代表平台启动、MariaDB 兼容、接口调用或原生表单已经验证通过**；实际执行结果应另记运行日志与验证报告。配置文件写入隔离运行目录，不覆盖现有平台配置，不把密码、token、真实公司数据提交到 Git。

## 1. 外部数据库配置与源码修复

运行目录使用 `config/externalDataSources.json`，内容是 JSON **数组**，不是以 `dataSources` 为键的对象。[Config.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/Config.java) 的路径常量和 `externalDataSources()` 读取配置；[ExternalDataSources.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/ExternalDataSources.java) 继承 `CopyOnWriteArrayList<ExternalDataSource>`。

导入基线存在两个阻碍：`ExternalDataSources.enable()` 固定返回 `false`，`Config.externalDataSources()` 固定返回空默认列表。仅填写 JSON 无法让原实现接入外部库。本仓库已登记 [PATCH-0001](../../patches/o2oa/0001-external-database-and-local-binding.md)，恢复配置读取及按启用项选择数据源。运行产物必须由包含修复的源码构建；源码已修改不等于运行 JAR 已更新。

以下只展示单一专用测试库的配置形状，所有占位符必须在本地替换：

```json
[
  {
    "enable": true,
    "url": "jdbc:mysql://127.0.0.1:3306/<NEW_TEST_SCHEMA>?useSSL=false&useUnicode=true&characterEncoding=UTF-8&serverTimezone=GMT%2B8",
    "username": "<TEST_SCHEMA_ONLY_USER>",
    "password": "<LOCAL_SECRET>",
    "driverClassName": "com.mysql.cj.jdbc.Driver",
    "dictionary": "mysql(clobTypeName=LONGTEXT,blobTypeName=LONGBLOB,maxIndexesPerTable=64,batchLimit=50)",
    "schema": "",
    "includes": [],
    "excludes": [],
    "maxTotal": 10,
    "maxIdle": 1,
    "autoCommit": false,
    "transactionIsolation": "read-committed",
    "logLevel": "ERROR"
  }
]
```

- [ExternalDataSource.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/ExternalDataSource.java) 定义上述字段；缺少 `enable` 默认禁用，缺少 URL 会回退到源码自带数据库名，缺少账号也有默认值，因此测试配置必须显式填写 URL、账号与密码。
- [SlicePropertiesBuilder.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/container/factory/SlicePropertiesBuilder.java) 识别 `jdbc:mysql` 并选用 `com.mysql.cj.jdbc.Driver` 和以上 MySQL OpenJPA dictionary。此处使用 MySQL 协议连接 MariaDB，仍需实测 Connector/J 版本、握手及 DDL 兼容；不能改成源码尚未识别的 `jdbc:mariadb` 然后假定有效。
- [PersistenceXmlHelper.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/container/factory/PersistenceXmlHelper.java) 按外部数据源启用状态选择内外库；单库和切片配置均使用 `openjpa.jdbc.SynchronizeMappings=buildSchema(ForeignKeys=false)`。**平台启动会建表或调整表结构**，不是只读连接检查。MySQL 库名由 JDBC URL 选择，模板的 `schema` 留空。
- 单一启用条目、空 `includes`/`excludes` 用于将平台实体归入同一专用库；不要混入现有业务数据源条目。更换数据源应完整停止并重启平台，不能依赖普通配置刷新切换连接池。

隔离约束应由数据库权限保证，而不只靠文件中填写库名：

1. 经授权创建一个全新、空的测试 schema 和专用账号，先确认名称不存在；建议库名仅用字母数字，避免数据库授权表达式中 `_`、`%` 的匹配歧义。
2. 该账号只授予这个新 schema 所需的权限，不授予全局权限、不以数据库管理员账号启动 OA。平台初始化需要建表能力，因此不能只给 `SELECT` 后声称已完成平台测试。
3. 启动前用专用账号核对 `SELECT DATABASE()`、`CURRENT_USER()` 和授权结果，并确认无法访问现有业务库；不在文档或日志中输出密码。
4. 启动后核对专用库中实际生成的平台表、实际连接的 catalog、重启后的测试数据；同时确认没有意外回落到内置 H2。只看到 HTTP 页面不构成数据库接入证据。

本说明未执行建库、授权或连接命令，也不包含现有数据库凭据。

## 2. 初始管理员与普通测试身份

运行目录 `config/token.json` 的字段由 [Token.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/Token.java) 定义：

```json
{
  "key": "<LOCAL_TEST_KEY>",
  "password": "<NEW_RANDOM_TEST_ADMIN_PASSWORD>",
  "rsaEnable": false
}
```

初始管理员名为 `xadmin`；`verifyPassword()` 核对配置中的管理员密码，`initialManagerInstance()` 构造带管理角色的虚拟管理员。无需先向人员表插入 xadmin。源码存在默认密码，本说明不复写该值，隔离环境必须显式设置自己的随机测试密码。

`key` 参与密码及 token 相关加密，应在建测试账号前设置并保持稳定；不能创建账号后随意替换。`password` 还会用于平台内部场景，不能视为仅影响登录界面的独立密码选项。

可在全新隔离运行目录内显式设置 `config/person.json`，使测试认证方式明确：

```json
{
  "userPwdLogin": true,
  "twoFactorLogin": false,
  "captchaLogin": false,
  "codeLogin": false,
  "bindLogin": false,
  "faceLogin": false,
  "xadminEnable": true,
  "tokenName": "x-token"
}
```

字段与默认值见 [Person.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/Person.java)。此模板只用于新建的本机测试实例，不修改现有环境的认证策略；首次改密等策略应在实际账号登录时核对，不能由前端忽略服务端要求。

烟测必须使用两个正常人员及其真实 Identity：A 发起、B 审批。虚拟 xadmin 不具备普通人员的组织身份，不能用它替代业务身份验证。

## 3. 节点、端口与监听范围

`local/node.cfg` 是单行文本；样例 [node.cfg](../../o2server/localSample/node.cfg) 内容为 `127.0.0.1`。它匹配 `config/node_127.0.0.1.json` 的节点名，**不是绑定所有服务监听地址的安全开关**。

新测试实例可用以下节点配置形状；端口仅为示例，使用前必须检查占用，并使代理目标与实际端口一致：

```json
{
  "enable": true,
  "autoStart": true,
  "nodeAgentEnable": false,
  "center": { "enable": true, "port": 18080, "sslEnable": false },
  "application": { "enable": true, "port": 18081, "sslEnable": false },
  "web": {
    "enable": true,
    "port": 18082,
    "sslEnable": false,
    "proxyCenterEnable": true,
    "proxyApplicationEnable": true
  },
  "data": { "enable": false },
  "storage": { "enable": false },
  "dumpData": { "enable": false },
  "restoreData": { "enable": false }
}
```

配置字段见 [Node.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/Node.java)、[CenterServer.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/CenterServer.java)、[ApplicationServer.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/ApplicationServer.java)、[WebServer.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/WebServer.java)。本基线常量的默认 HTTP 端口包含 80；不能把旧说明中的 20020/20030 当作实际运行事实。

| 服务 | 源码行为 | 本机最小烟测约束 |
| --- | --- | --- |
| Center / Application / Web / 初始化 HTTP | 原 [JettySeverTools.java](../../o2server/x_console/src/main/java/com/x/server/console/server/JettySeverTools.java) 只设置端口，未绑定主机。PATCH-0001 增加可选 `o2oa.bindHost`，HTTP 与 HTTPS connector 均设置 host。 | 用包含补丁的运行产物，显式传入 `-Do2oa.bindHost=127.0.0.1`。初始化服务同样使用该公共 connector 方法。 |
| 节点代理 | [NodeAgent.java](../../o2server/x_console/src/main/java/com/x/server/console/NodeAgent.java) 使用 `new ServerSocket(port)`，默认可能监听全部地址；[Main.java](../../o2server/x_console/src/main/java/com/x/server/console/Main.java) 按 `nodeAgentEnable` 决定是否启动。 | 显式 `nodeAgentEnable:false`。HTTP 绑定参数不覆盖此 socket。 |
| 内置 H2 | [DataServerTools.java](../../o2server/x_console/src/main/java/com/x/server/console/server/data/DataServerTools.java) 启动参数含 `-tcpAllowOthers`、`-webAllowOthers`；[StartCommand.java](../../o2server/x_console/src/main/java/com/x/server/console/command/StartCommand.java) 在未启用外部库时考虑启动内置数据服务。 | 外部库修复和配置必须实际生效，且 `data.enable:false`；不能以 H2 静默回退代替 MariaDB 联调。 |
| FTP 存储 | [StorageServerTools.java](../../o2server/x_console/src/main/java/com/x/server/console/server/storage/StorageServerTools.java) 的 `ListenerFactory` 只设置端口；被动数据端口另行配置，未指定 loopback 地址。 | 本轮无附件最小烟测 `storage.enable:false`。要验证附件时，应另行处理 FTP 控制与数据通道地址，不只修改 Jetty。 |

启动后按实际 Java PID 检查全部 TCP、UDP 监听，确认没有 `0.0.0.0`、`::` 或非 loopback 地址；需覆盖平台子进程与新 Web 开发服务。HTTP 请求可达与 `node.cfg=127.0.0.1` 都不能代替 socket 审计。记录实际 PID、端口、绑定地址即可，不记录认证密钥。

## 4. 新建最小测试组织、人员和设计对象

以下为源码核对的请求契约，尚未执行。路径以所选服务的根路径为前缀；不要把新 Web 的 `/o2-api/auth`、`/o2-api/process` 别名直接用于组织和设计服务。服务地址需从实际部署确认。

组织服务根路径：`/x_organization_assemble_control/jaxrs`。以新实例管理员身份建立全新的测试组织和两个人员，不触及现有组织。

| 方法与路径 | 最小输入 / 结果 | 源码 |
| --- | --- | --- |
| `POST /unit` | `{ "name":"独立联调组织_<suffix>", "unique":"oaitunit<suffix>" }`；成功包的 `data.id` 为实际组织 ID。 | [unit/ActionCreate.java](../../o2server/x_organization_assemble_control/src/main/java/com/x/organization/assemble/control/jaxrs/unit/ActionCreate.java) |
| `POST /person` | `{ "name":"联调发起人_<suffix>", "unique":"oaita<suffix>", "password":"<RANDOM_TEST_PASSWORD>", "unit":"<UNIT_ID>" }`；B 使用另一独立 unique 和密码。成功返回 `data.id`。 | [person/ActionCreate.java](../../o2server/x_organization_assemble_control/src/main/java/com/x/organization/assemble/control/jaxrs/person/ActionCreate.java) 87–100 行设置输入密码，有 unit 时自动创建 Identity。 |
| `GET /identity/list/person/{personFlag}` | 用实际人员 ID 获取身份数组，从结果取 `distinguishedName` 作为 `A_IDENTITY_DN` / `B_IDENTITY_DN`，不拼显示名代替。 | [identity/IdentityAction.java](../../o2server/x_organization_assemble_control/src/main/java/com/x/organization/assemble/control/jaxrs/identity/IdentityAction.java) 181–200 行；[ActionListWithPerson.java](../../o2server/x_organization_assemble_control/src/main/java/com/x/organization/assemble/control/jaxrs/identity/ActionListWithPerson.java) |

设计服务根路径：`/x_processplatform_assemble_designer/jaxrs`。

1. `POST /application`，输入唯一的 `name`、`alias`，使用返回的 `data.id`。见 [application/ActionCreate.java](../../o2server/x_processplatform_assemble_designer/src/main/java/com/x/processplatform/assemble/designer/jaxrs/application/ActionCreate.java)。调用者需具有设计权限。
2. `POST /form`，输入客户端生成 GUID 的 `id`、`name`、`application`、`data` 和 `formFieldList`。见 [form/ActionCreate.java](../../o2server/x_processplatform_assemble_designer/src/main/java/com/x/processplatform/assemble/designer/jaxrs/form/ActionCreate.java) 38–93 行。首个表单会在应用尚无有效默认表单时成为默认表单。
3. `POST /process`，输入下一节 `processPayload`。此入口接收 `WrapProcess` 及子节点列表并一起持久化，不是任意业务 JSON 导入器。见 [process/ActionCreate.java](../../o2server/x_processplatform_assemble_designer/src/main/java/com/x/processplatform/assemble/designer/jaxrs/process/ActionCreate.java) 41–107 行和 [WrapProcess.java](../../o2server/x_processplatform_core_entity/src/main/java/com/x/processplatform/core/entity/element/wrap/WrapProcess.java)。

不调用删除已有应用或强制创建工作接口。重复运行的 seed 应持有自己的清单并核对专用 alias、ID 与测试库身份，避免把同名现有对象当作测试产物覆盖。

### 4.1 原生表单数据格式

原生表单不是 HTML 字符串单独上传。完整定义结构以 [Form/template.json](../../o2web/source/x_component_process_FormDesigner/Module/Form/template.json) 的 `pcData` 为基础：`{ "json": { ... }, "html": "..." }`，`json.id` 与 HTML 根表单 ID 应一致。字段组件定义放入 `json.moduleList`，HTML 内相应元素的 `MWFType`、`id` 与组件类型、字段 ID 一致；文字字段模板见 [Textfield/template.json](../../o2web/source/x_component_process_FormDesigner/Module/Textfield/template.json)。

最小测试可只添加 `smokeText` 文本字段；优先沿用原生设计器模板的完整默认字段，不自行裁剪后宣称与全部动态表单兼容。表单上传时将对应字段声明为 `formFieldList:[{"name":"smokeText","dataType":"string"}]`。

[设计器服务 JS](../../o2web/source/o2_core/o2/xAction/services/x_processplatform_assemble_designer.js) 193 行以后的 `addForm` / `updateForm` 将表单对象序列化并再次转义；编码函数见 [o2.js](../../o2web/source/o2_core/o2.js) 2771–2779 行。等价的标准 JavaScript 表达式为：

```js
const serialized = JSON.stringify(formDefinition);
const encodedFormData = JSON.stringify(serialized).slice(1, -1);
const formPayload = {
  id: formId,
  name: "独立联调表单",
  application: applicationId,
  hasMobile: false,
  data: encodedFormData,
  formFieldList: [{ name: "smokeText", dataType: "string" }]
};
```

此处 `data` 是经原生编码后的字符串；直接把对象或未经该编码的 JSON 字符串塞入 `data` 不等同于设计器的保存契约。测试后须实际在浏览器原生运行页确认渲染、输入与保存。

### 4.2 两个人工节点的 processPayload

以下是可序列化的请求模板，**尚未运行验证**。所有 `*_ID` 替换为互不相同的 GUID，`APPLICATION_ID`、`FORM_ID` 使用实际已创建对象；两个身份 DN 必须从组织 API 获取。两个 Manual 的目的是先让 A 驱动草稿，再产生 B 的真实待办，匹配新 Web 默认排除草稿的列表语义。

```json
{
  "id": "<PROCESS_ID>",
  "name": "独立联调流程_<suffix>",
  "alias": "oaitflow<suffix>",
  "application": "<APPLICATION_ID>",
  "expireType": "never",
  "startableIdentityList": ["<A_IDENTITY_DN>"],
  "begin": {
    "id": "<BEGIN_ID>",
    "name": "开始",
    "form": "<FORM_ID>",
    "route": "<ROUTE_ENTER_ID>"
  },
  "manualList": [
    {
      "id": "<MANUAL_SUBMIT_ID>",
      "name": "发起填报",
      "form": "<FORM_ID>",
      "manualMode": "single",
      "taskExpireType": "never",
      "taskIdentityList": ["<A_IDENTITY_DN>"],
      "routeList": ["<ROUTE_SUBMIT_ID>"]
    },
    {
      "id": "<MANUAL_APPROVE_ID>",
      "name": "审批",
      "form": "<FORM_ID>",
      "manualMode": "single",
      "taskExpireType": "never",
      "taskIdentityList": ["<B_IDENTITY_DN>"],
      "routeList": ["<ROUTE_APPROVE_ID>"]
    }
  ],
  "endList": [
    { "id": "<END_ID>", "name": "结束", "form": "<FORM_ID>" }
  ],
  "routeList": [
    {
      "id": "<ROUTE_ENTER_ID>",
      "name": "进入填报",
      "activityType": "manual",
      "activity": "<MANUAL_SUBMIT_ID>"
    },
    {
      "id": "<ROUTE_SUBMIT_ID>",
      "name": "提交",
      "activityType": "manual",
      "activity": "<MANUAL_APPROVE_ID>"
    },
    {
      "id": "<ROUTE_APPROVE_ID>",
      "name": "同意",
      "activityType": "end",
      "activity": "<END_ID>"
    }
  ]
}
```

字段依据：

- [Begin.java](../../o2server/x_processplatform_core_entity/src/main/java/com/x/processplatform/core/entity/element/Begin.java) 442–446 行是单个 `route`，不是 `routeList`。
- [Manual.java](../../o2server/x_processplatform_core_entity/src/main/java/com/x/processplatform/core/entity/element/Manual.java) 的 `form`、`routeList`、`taskIdentityList`、`manualMode` 与 [ManualMode.java](../../o2server/x_processplatform_core_entity/src/main/java/com/x/processplatform/core/entity/element/ManualMode.java) 的 `single` 枚举值。
- [Route.java](../../o2server/x_processplatform_core_entity/src/main/java/com/x/processplatform/core/entity/element/Route.java) 170–188 行定义目标 `activityType` 与 `activity`；[ActivityType.java](../../o2server/x_processplatform_core_entity/src/main/java/com/x/processplatform/core/entity/element/ActivityType.java) 的枚举为小写。
- [process/BaseAction.java](../../o2server/x_processplatform_assemble_designer/src/main/java/com/x/processplatform/assemble/designer/jaxrs/process/BaseAction.java) 为创建的节点及路由自动设置 `process`；创建流程时还自动设置创建者、编辑时间及启用版本信息。
- [ProcessFactory.java](../../o2server/x_processplatform_assemble_surface/src/main/java/com/x/processplatform/assemble/surface/factory/element/ProcessFactory.java) 303 行起检查启动身份、组织、群组和角色。模板将发起范围限定为 A 的身份，仍需用 A、B 实际会话分别验证。

## 5. 工作创建、真实处理与新 Web 烟测

运行服务根路径：`/x_processplatform_assemble_surface/jaxrs`。每一步使用当前测试人员自己的正常认证会话，不能通过管理员身份代办来替代本人权限测试。

1. A 登录后 `POST /work/process/{PROCESS_ID}`，输入：

   ```json
   {
     "title": "独立联调单_<suffix>",
     "identity": "<A_IDENTITY_DN>",
     "data": { "smokeText": "独立测试字段值_<suffix>" }
   }
   ```

   源码：[WorkAction.java](../../o2server/x_processplatform_assemble_surface/src/main/java/com/x/processplatform/assemble/surface/jaxrs/work/WorkAction.java) 180 行附近；[ActionCreate.java](../../o2server/x_processplatform_assemble_surface/src/main/java/com/x/processplatform/assemble/surface/jaxrs/work/ActionCreate.java)；[ActionCreateWi.java](../../o2server/x_processplatform_core_express/src/main/java/com/x/processplatform/core/express/assemble/surface/jaxrs/work/ActionCreateWi.java)。不设置 `allowEdition`、`skipDraftCheck`，不使用 `/force`。

   成功包的 `data` 是工作日志对象**数组**，对象可含 `taskList`、`currentTaskIndex`；见 [BaseCreateAction.java](../../o2server/x_processplatform_assemble_surface/src/main/java/com/x/processplatform/assemble/surface/jaxrs/work/BaseCreateAction.java) 110–194 行。取实际 task/work/job ID，不把顶层 `data.id` 当作唯一工作 ID。

2. A 读取 `GET /task/{TASK_ID}` 或 `GET /task/list/work/{WORK_ID}`，核对本人、工作、当前环节及可用路由。Task 含 `routeList`、`routeNameList`，见 [Task.java](../../o2server/x_processplatform_core_entity/src/main/java/com/x/processplatform/core/entity/content/Task.java) 182–205、540–561 行；授权读取见 [task/ActionGet.java](../../o2server/x_processplatform_assemble_surface/src/main/java/com/x/processplatform/assemble/surface/jaxrs/task/ActionGet.java)。

3. A **POST** `/task/{A_TASK_ID}/processing`，body：

   ```json
   { "routeName": "提交", "opinion": "独立联调提交" }
   ```

   方法见 [TaskAction.java](../../o2server/x_processplatform_assemble_surface/src/main/java/com/x/processplatform/assemble/surface/jaxrs/task/TaskAction.java) 413–430 行。`routeName` 必须与此 Task 的实际 `routeNameList` 相符；不发送自行定义的 `approve`、`decision` 或自动 `action`。其他支持字段如 `mediaOpinion`、`routeData`、`appendTaskIdentityList`、`ignoreEmpowerIdentityList`、`action`、`option` 见 [ActionProcessingWi.java](../../o2server/x_processplatform_core_express/src/main/java/com/x/processplatform/core/express/assemble/surface/jaxrs/task/ActionProcessingWi.java)，最小正向流程无需它们。

4. B 用自己的会话查询 `POST /task/v2/list/paging/1/size/20`，body `{ "key":"独立联调单_<suffix>", "isExcludeDraft":true }`。在新 Web 真实连接模式找到同一工作，核对列表、详情、搜索、分页与原生表单入口。A 的草稿被排除不构成 B 待办成功；必须实际看到 B 的待办。

5. 在浏览器打开真实原生运行页 `<TRUSTED_PLATFORM_WEB_ROOT>/x_desktop/work.html?workid=<WORK_ID>`。不在 URL 中拼 token，不附 `action=processTask` 等自动执行参数。核对表单实际渲染、文本字段值、可编辑性与保存；待办不强制只读。已办打开可加 `readonly=true`；若已经归档，使用 `workCompletedId=<实际归档ID>`。

6. B 从实际路由中选择“同意”，以本人会话 `POST /task/{B_TASK_ID}/processing`，body `{ "routeName":"同意", "opinion":"独立联调通过" }`。随后轮询本人待办消失、`POST /taskcompleted/v2/list/paging/1/size/20`（body `{ "key":"独立联调单_<suffix>", "latest":true }`）出现对应已办，并核对流程归档状态。**已办不自动等于整个流程结束**；本例需另查工作/归档记录。

7. 正常停止并重启测试实例，确认同一专用 MariaDB 库仍有测试组织、表单、流程、工作及字段值；记录查询结果摘要和实际对象 ID 的脱敏形式。不得用内存样例、浏览器本地存储或仅 HTTP 成功代替持久化证据。

处理响应为 `Record` 的扩展对象，可能附 `signalStack`、`occurSignalStack`，不是新的 Task 数组；见 [ActionProcessingWo.java](../../o2server/x_processplatform_core_express/src/main/java/com/x/processplatform/core/express/assemble/surface/jaxrs/task/ActionProcessingWo.java)。[ActionProcessing.java](../../o2server/x_processplatform_assemble_surface/src/main/java/com/x/processplatform/assemble/surface/jaxrs/task/ActionProcessing.java) 使用工作线程处理且内部异常可能只写日志，因此必须重查实际状态，不能只凭 `200` 或成功 envelope 判断流转完成。所有接口同时检查 HTTP 状态与 O2OA 的逻辑错误包。

只读摘要使用 `GET /work/{id}` 或实际归档后的 `GET /workcompleted/{id}`。V2 聚合读取会涉及阅读标记，不作为“无写入副作用”的验证手段；原生表单由用户主动打开时产生的平台阅读记录应如实记录。

## 6. 完成烟测后的结论边界

最小烟测需证明：运行产物包含必要源码补丁、仅连接专用 MariaDB schema、监听受限、真实普通账号会话有效、A 到 B 流转成立、新 Web 能展示实际待办/已办、原生表单能渲染保存、数据重启后仍在。每项保留通过或失败的客观证据。

即使上述均通过，也只证明这一条隔离测试流程的技术连通性；不代表原系统 132 个对象或 60 条审批已迁移，不代表多公司授权、所有动态表单脚本、附件、正式会计及生产登录策略已经验收。后续覆盖范围仍按 [需求范围](../requirements/01-scope-and-requirements.md) 与 [验收计划](01-acceptance-plan.md) 执行。
