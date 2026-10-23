# PATCH-0001：外部数据库启用与本机 HTTP 绑定

- 日期：2026-10-24，Asia/Shanghai。
- 来源：`upstream.json` 固定的 O2OA 源码基线。
- 关联：REQ-011、用户要求 MariaDB 独立测试库及真实平台联调。

## 原因与修改

`ExternalDataSources.enable()` 原实现固定返回 `false`，调用方因此无法依照 `externalDataSources.json` 的启用项选择外部数据源。本次改为仅当至少一个非空条目的 `enable` 为 `true` 时启用。空列表、全禁用或空条目不启用外部数据源；保留原有条目命名及选择逻辑。

`Config.externalDataSources()` 同时固定返回空默认列表，未读取配置文件。本次按邻接的外部存储配置模式恢复读取与缓存：缺少配置文件时仍用空列表，存在时读取原生 JSON 数组。已有配置重载时对数据源缓存的保留逻辑不变。

`ResourceFactory.initDataSources()` 原实现只注册内置 H2 数据源。恢复配置启用后，OpenJPA 会查询外部 `jdbc/s001` 等 JNDI 名称，而原控制台未创建相应连接池。本次按启用项注册外部 Druid 适配器，沿用 `ExternalDataSources.name()` 的命名及 `ExternalDataSource.getPassword()` 的密码解析契约，传递池大小、检测、空闲、自动提交及统计配置。初始化异常会释放已创建的池和 JNDI 绑定并向上传播；控制台销毁时关闭外部池并释放绑定。无启用外部项时保留原有 H2 分支。新增回归测试验证配置映射、加密密码解析、JNDI 命名、禁用项跳过、失败清理与销毁；测试不连接真实数据库。

`JettySeverTools` 的 HTTP/HTTPS connector 原实现只设置端口，未提供绑定地址。新增可选 JVM 参数 `-Do2oa.bindHost=127.0.0.1`，设置 connector 的监听主机。未传参数时保持上游默认行为；这是隔离环境的显式限制，不替代对其他监听端口的核查。

源码位置：

- [ExternalDataSources.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/ExternalDataSources.java)
- [Config.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/Config.java)
- [ResourceFactory.java](../../o2server/x_console/src/main/java/com/x/server/console/ResourceFactory.java)
- [ResourceFactoryDataSourcesTest.java](../../o2server/x_console/src/test/java/com/x/server/console/ResourceFactoryDataSourcesTest.java)
- [JettySeverTools.java](../../o2server/x_console/src/main/java/com/x/server/console/server/JettySeverTools.java)
- [pom.xml](../../o2server/pom.xml)：将 Surefire 固定跳过改为默认值仍为 `true` 的参数，允许显式 `-DskipTests=false -Dtest=ExternalDataSourcesTest` 运行新增回归测试。

## 验证与升级

已用本仓库修改后源码构建并完成 2 项配置及 3 项 JNDI／池测试；真实联调确认独立 MariaDB 专用账号的系统库拒绝、实际平台表及流程写入／回读、平台与数据库重启持久化。Java 的三个 HTTP 监听均为 127.0.0.1，无 UDP；详见[运行报告](../../docs/verification/platform-runtime.md)。这不代表生产容量、其他监听配置和完整业务均已验收。

后续同步上游时核对数据库启用函数与 connector 配置；如上游已提供同等能力，应删除重复补丁并重跑数据库和监听测试。不能用其他版本预编译包代替本补丁的构建与验证。
