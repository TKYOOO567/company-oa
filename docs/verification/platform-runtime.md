# O2OA、Web 与 MariaDB 隔离联调报告

记录日期：2026-10-24，Asia/Shanghai。关联 REQ-003、REQ-008、REQ-011、[Web 第一版](web-v0.1.md)、[源码核对说明](integration-source-notes.md) 和 [验收计划](01-acceptance-plan.md)。

**真实隔离联调已通过：本仓库构建的 O2OA 与新 Web 接入独立 MariaDB，从全新专用库创建合成流程，完成 A 发起、B 审批、双方已办及整条流程归档；正常停止并重启平台和数据库后，中文业务数据与完成状态仍可回读。真实 Chrome 的待办阶段 2 项、完成阶段 1 项均通过。**

本结论限于本报告的合成流程和本机测试配置。原公司业务、公司隔离、完整财务、历史迁移、性能及云部署尚未验收。实际凭据、token、原始日志与私有回执保存在工程忽略目录 `.local/`，本报告仅记录脱敏结果。

## 1. 最终验证环境与来源

| 项目 | 已核实结果 |
| --- | --- |
| Java / javac | 便携 Java 11.0.23，64 位；Maven 实际使用该 JVM |
| Maven | Apache Maven 3.9.11 |
| 上游来源 | 固定导入提交 `0b328b1cd88e221d25a6188f47b3d6e08de69fbe`，见 [upstream.json](../../upstream.json) |
| 本项目源码快照 | Git 基线 `3bee65ab457372ac698cd69408897cf6532b214a` 加实际工作树修复；最终来源清单记录 9 个源码覆盖项 |
| 服务端构建 | Maven reactor 56 项成功：根聚合项目与 55 个子模块 |
| 原生 Web | 上游 Gulp 构建成功，Work/Xform 页面及压缩资源产物检查通过 |
| 最终运行目录 | `.local/runtime/o2server-it-clean/`，使用从零创建的最终专用测试库 |
| MariaDB | 独立 MariaDB 12.3.2，`127.0.0.1:13306` |
| JDBC | MySQL Connector/J 8.4.0，`jdbc:mysql`，显式使用本项目 MySQL 字典扩展 |
| 实际运行产物 | 29 个 WAR、25 个共享 JAR 及 console.jar，全部与源码构建产物逐一 SHA-256 比对通过 |

源码快照位于 `.local/runtime/source-build/source-3bee65ab4573-20261024004402/`。`source-manifest.json`、Git blob 清单、`source-overrides.json` 与工作树补丁区分原始来源及实际修改；Server、CoreTest、Web、Console、Assemble、CoreBuild 分别有成功回执和日志。控制台及共享核心在各自修复后重新构建；最终产物核对针对实际运行目录，而不只检查最初的组装目录。

`runtime-artifacts.json` 已核对上述 55 个源码产物、9 个源码覆盖项及必要运行文件。这个工具只验证来源、文件及回归测试证据；平台运行与数据库结论由后续真实检查独立支持。

依赖归档保留实际摘要。JVM 下载地址含可变 `master`，commons 采用上游准备脚本指定的 9.3 归档；归档名不代表本次应用版本。准备、构建、摘要和完整复现命令见 [本机开发与真实联调说明](../../deployment/dev/README.md)。

## 2. 自动检查结果

| 检查 | 实际结果 | 验证范围 |
| --- | --- | --- |
| `ExternalDataSourcesTest` | 2 项通过，失败／错误／跳过均为 0 | 外部数据源启用选择 |
| `ResourceFactoryDataSourcesTest` | 3 项通过，失败／错误／跳过均为 0 | 池参数与密码解析、JNDI 注册、销毁及失败清理 |
| `CompanyOaMySQLDictionaryTest` | 4 项通过，失败／错误／跳过均为 0 | 目标索引前缀 DDL、列长度保持、唯一性与非目标索引边界 |
| 新 Web 单元测试 | 53 / 53 通过 | HTTP 契约、状态与会话边界；包括退出后恢复连接策略的修复 |
| 真实 Chrome：待办阶段 | 2 / 2 通过 | B 登录、真实待办搜索／摘要／原生页；B 退出后切换 A，A 的列表不含 B 的待办 |
| 真实 Chrome：完成阶段 | 1 / 1 通过 | 读取真实已办列表与对应详情 |

Java 结果已从 Surefire XML 核对，共 9 项。普通 Server 构建默认跳过测试；这里的通过数来自明确执行的三个测试类，不代表上游全量 Java 测试。

连接池关闭测试使用禁止建立数据库连接的 Driver 初始化空池，再验证实际关闭及 JNDI 解绑。Druid 1.2.27 对未初始化池调用 `close()` 不设置 `isClosed`，测试已按该真实语义验证，未以删除关闭断言绕过失败。

Chrome 使用真实启动的平台、新 Web 和两个专用普通账号，无演示模式或请求模拟。原生页使用 MWF Textfield 绑定后端已存的中文 `note`，HTML 不写死字段值；验证正确显示且不可编辑，浏览器检查没有执行审批路由。B 的审批由独立流程核对工具执行。

## 3. 必要平台修复与数据库兼容

[PATCH-0001](../../patches/o2oa/0001-external-database-and-local-binding.md) 恢复外部数据源配置读取和启用判断，并在 `ResourceFactory` 注册 OpenJPA 所需的 `jdbc/s001` 等 JNDI 连接池。密码沿用平台解析契约；失败与销毁时关闭外部池、释放绑定，清理异常保留并向上传播。HTTP/HTTPS 增加可选 `-Do2oa.bindHost=127.0.0.1`；节点代理、内置 H2 和 FTP 另由测试配置关闭。

首次尝试在旧测试库创建工作时，`QRY_ITEM_stringShortValue` 的完整组合索引超过 MariaDB/InnoDB 的 3072 字节限制，留下缺失索引的旧库。该次尝试保留为失败诊断，最终通过证据来自另建的全新专用库及 `o2server-it-clean` 环境，从零建表并完成流程。

[PATCH-0002](../../patches/o2oa/0002-mariadb-utf8mb4-index.md) 通过显式字典扩展，仅为已核实签名的超长非唯一索引生成列前缀，保留字段、字符集、唯一约束和完整查询谓词。实际新库已核对：

| 检查 | 结果 |
| --- | --- |
| `QRY_ITEM_stringShortValue` 存在 | 通过 |
| `xbundle`、`xstringShortValue` 索引前缀 | 各为 128 字符 |
| `xpath0`～`xpath3` 索引 | 完整列，无前缀截取 |
| 两个原始字符串列 | 仍为 VARCHAR(255)、utf8mb4 |
| 相同前缀、不同后缀的完整 WHERE 查询 | A、B 各准确返回 1 行 |
| 四字节 Unicode 探针 | 按预期返回 2 行 |
| 事务回滚后的探针残留 | 0 行 |

实际数据库检查由 [Test-MariaDbIndex.ps1](../../deployment/dev/Test-MariaDbIndex.ps1) 执行，回执为最终运行目录下的 `mariadb-index-verification.json`。这些检查证明本次字段和索引的正确性，未证明前缀索引与完整索引具有相同性能。

## 4. 独立实例、监听与测试配置

本次 MariaDB 使用独立进程及全新数据目录 `.local/runtime/mariadb-integration/`，未注册新的 Windows 服务。最终专用 schema 与账号通过指定库连接及系统用户表跨库拒绝检查。原有 3306 实例未用于本报告，其认证、数据及运行能力未在本轮验证。

正常停止与重启后，MariaDB PID 为 26396，Java PID 为 25888。三个 HTTP 端口 18020、18030、18080 均只监听 `127.0.0.1`，Java 无 UDP 监听；数据库使用 `127.0.0.1:13306`。节点代理、内置 H2、FTP、定时备份／恢复均关闭。JVM 最大堆 1280 MiB 属于本机验证配置，未据此给出生产容量结论。

测试配置关闭首次强制改密及短信／绑定登录，并使用合成手机号标识。57 种消息类型和全局消息 consumers 均显式为空，避免精简环境触发未部署的消息服务；本轮未验证通知、短信、推送或回调。这些配置不构成生产账号或通知策略。

## 5. 真实流程、数据库与重启结果

| 步骤 | 结果及证据 |
| --- | --- |
| 从零建立测试资料 | 普通人员 A、B、组织、应用、真实 MWF 表单和两个人工节点流程创建成功 |
| A 发起并提交 | A 的草稿完成提交，B 获得同一工作的真实非草稿待办 |
| 待办数据库核对 | 待办 1、在途工作 1、A 已办 1、已知 B 待办匹配 1；当时 196 张平台表、3 个平台持有连接 |
| B 实际同意 | 正向流程核对工具确认本人待办及真实路由后办理；双方已办均存在，整条 job 结束，中文业务数据可回读 |
| 正常停止 | O2OA 使用 exit，独立 MariaDB 使用 SHUTDOWN，均保留原数据及配置 |
| 两进程重启 | 全部三个 HTTP 端口就绪后，`--read-only` 核对通过：流程已结束、中文数据正确，本轮无流程写入 |
| 最终数据库核对 | 214 张平台表，待办 0、在途工作 0、已办 2、归档工作 1；平台持有连接 3 |
| 完成阶段浏览器 | 真实 Chrome 1 项通过，读取实际已办及对应详情 |

流程回执 `.local/verification/o2oa-workflow.json` 为 `status:passed`、`submittedDuringThisRun:true`、`workflowEnded:true`。重启后的 `o2oa-workflow-read-only.json` 为 `status:passed`、`mode:read-only`、`submittedDuringThisRun:false`、`persistenceRecheckedWithoutWorkflowWrite:true`；已办、归档元数据、`integrationMarker` 和中文 `note` 的检查通过。只读模式中针对“办理前待办”的检查不适用，未用它们冒充办理结果。

最终运行目录的 `database-pending-verification.json` 与 `database-completed-verification.json` 从 MariaDB 实表核对 catalog、连接和已知对象计数；不是只检查配置文件或首页。完成后没有再次 seed，持久化结论来自保留数据的正常重启。

重启初期曾在服务注册尚未完成时执行一次只读核对，返回 500，已保留诊断。等待全部三个 HTTP 服务就绪后重跑才取得上述通过证据；首次失败未计为通过。就绪等待操作见 [开发说明](../../deployment/dev/README.md)。

## 6. 会话与日志缺口

曾出现在错误日志中的旧 A 测试 token 已通过平台 `safe/logout` 服务端作废，随后核对旧会话为匿名；脱敏回执为 `.local/verification/test-session-revocation.json`，其中 `revoked` 与 `oldSessionAnonymous` 均为 true。未通过轮换人员密码加密密钥清理会话。

平台错误日志写入层仍可能记录认证请求头，本轮没有修改这一层源码。现有私有日志仅经安全提取和脱敏诊断，凭据、token 不进入公开报告；正式部署前仍需修复并验证日志脱敏。这是保留的真实缺口，合成流程通过不关闭该项。

## 7. 验证边界与后续验收

本次证明的是一条合成流程在真实 O2OA、新 Web、原生 MWF 和 MariaDB 上的创建、办理、归档及重启持久化。A／B 为专用测试组织的正常人员；账号切换检查只覆盖该任务的人员可见性，尚不证明公司的多组织、多公司授权边界。

只读 Textfield 检查覆盖读取已存中文值，未覆盖原生表单编辑保存、全部动态组件、复杂脚本和附件。消息消费者被明确禁用，附件、短信、通知和推送未验收。

原公司流程规则、客户／项目共享、总部汇总、多公司独立核算、正式会计、历史迁移与在途切换，以及性能、生产登录、云服务器部署均须继续按 [需求范围](../requirements/01-scope-and-requirements.md)、[待确认事项](../requirements/03-open-questions.md) 与 [验收计划](01-acceptance-plan.md) 验证。本报告不代表公司 OA 全量替换已经完成。
