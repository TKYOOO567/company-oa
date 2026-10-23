# O2OA 与本机数据库运行调查

记录时间：2026-10-24，Asia/Shanghai。关联 REQ-003、REQ-008、REQ-011 及平台接入阶段。本轮用户已授权先开发 Web，并允许测试需要时启动本机 MariaDB；本报告只记录实测及后续运行路径，不把 Web 单测或演示 E2E 当作真实平台／数据库联调。

**结论：当前未启动 O2OA，未构建平台，未建立经过认证的 MariaDB 连接，未验证 O2OA 与 MariaDB 的 JDBC 兼容性。** 已交付可重复的环境预检、loopback HTTP 探测和数据库服务检查脚本。当前 Web v0.1 的真实 API 契约测试、显式演示 E2E 与前端构建应分别记录，不能替代上述缺口。

## 1. 实测环境

| 检查项 | 2026-10-24 结果 | 含义 |
| --- | --- | --- |
| Node | v24.15.0 | 可以用于新 Web 工程；未据此验证上游全部 Gulp 依赖兼容性 |
| npm | 11.18.0，实际执行结果 | 本机 shim 会选有效 prefix，不能只读 Node 安装目录内旧 npm 包版本代替实测 |
| java / javac | PATH 均未找到 | 尚不具备 Java 源码构建环境；完整发布包可自带 JVM |
| Maven / Ant | PATH 均未找到 | 当前 npm 服务端任务实际调用 Maven；Ant 不是该任务的必需入口 |
| Docker | CLI 存在，29.5.3；desktop-linux 引擎不可达 | named pipe 不存在，不能把已安装 CLI 当成可用容器运行环境 |
| 物理内存 | 总计约 14.7 GiB；调查期间空闲约 2.6～2.8 GiB | 低于上游 Windows 启动脚本的 4 GiB 固定初始堆，另需考虑 JVM 原生内存和其他应用 |
| C 盘 | 调查时约 194 GiB 可用 | 空间快照，不代表完整编译／发布包占用已经测量 |
| 平台产物 | 当前源码目录扫描到服务端 JAR/WAR 为 0 | 尚无可直接启动的 `console.jar` 及服务发布产物 |

预检工具：[Test-O2Platform.ps1](../../deployment/dev/Test-O2Platform.ps1)。工具输出包含本机路径，保存输出时应放 `.local/runtime/` 等忽略目录，不能把真实运行配置或后续凭据写入公开仓库。

## 2. 源码构建与启动事实

| 证据 | 已确认事实 |
| --- | --- |
| [o2server/pom.xml](../../o2server/pom.xml) | Java source/target 11；聚合构建含 55 个模块 |
| [根 package.json](../../package.json) | `build_server_script` 在 `o2server` 内执行 `mvn clean` 和 `mvn install`；完整任务还包含 Web/API 打包及部署整理 |
| [gulpfile.js](../../gulpfile.js) | `preperation:win` 所用准备阶段下载 commons 与 Windows Java11 组件；Web 产物写入 `target/o2server/servers/webServer` |
| [x_console/pom.xml](../../o2server/x_console/pom.xml) | 控制台主类为 `com.x.server.console.Main`，打包过程产生 `console.jar`；它不是现有可运行 JAR |
| [start_windows.bat](../../o2server/start_windows.bat) | 启动依赖包内 `jvm/windows_java11`、`console.jar` 和 `commons/module_java11` 的编译器模块；默认 `-Xms4g -Xmx4g`，并有本地更新目录处理行为 |
| [ApplicationServer.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/ApplicationServer.java)、[CenterServer.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/CenterServer.java)、[WebServer.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/WebServer.java) | 当前 fork 的三个默认 HTTP 端口常量都为 80；部分注释和旧说明仍描述 20020／20030，应以实际配置及服务发现为准 |
| [JettySeverTools.java](../../o2server/x_console/src/main/java/com/x/server/console/server/JettySeverTools.java) | 所读 HTTP connector 代码设置端口，未在该处限制监听地址；不能把 `localSample/node.cfg` 的 127.0.0.1 自动解释为仅本机开放 |

当前缺少 `console.jar`、`commons/`、`jvm/windows_java11/`、服务 WAR/JAR 和打包的 Web 目录。本次没有执行上游 `start_windows.bat`，避免在产物不全、资源不足及尚未确认隔离配置的情况下触发更新或启动。

## 3. 最短可行路径与当前停止位置

最短的平台运行验证路径是取得**固定版本完整 Windows 发布包**，解压到本工程 `.local/runtime/`，使用包内 JVM；这样不要求先构建 55 个模块。发布包只能证明该发布版本，不能自动证明与本工程固定源码提交相同。取得包时应同时记录发布版本、原始下载 URL、文件大小、SHA-256、包内版本和与源码基线的关系。

本次只对仓库准备脚本给出的两个官方依赖地址做 HEAD 检查：commons 路径固定为 `9.3`，JVM 路径使用可变的 `master`。两个请求最终均返回 HTTP 200，但没有给出 Content-Length，因此没有确认下载体积、摘要或包内容；它们也不是完整发布包。GitHub 官方仓库最新 release 元数据请求超时，未据此选定版本。本轮按协调要求停止大包调查和下载，**没有取得可报告摘要的发布包**。

官方[源码编译说明](https://www.o2oa.net/cms/source/335.html)和 [Windows 部署说明](https://www.o2oa.net/cms/serverdeployment/694.html)可作为后续操作入口；实际版本、依赖和端口仍应与本工程源码及下载包核对。

后续继续平台验证时按以下顺序推进：

1. 确认完整发布包版本和摘要；或在 `.local/runtime/source-build/` 的隔离源码副本中准备非安装式 JDK 11、Maven 及依赖，再按上游脚本构建。构建缓存与运行产物留在 `.local/`，不修改平台源码。准备脚本会写入及清理 `o2server` 子路径，不能不经检查就在正式源码树中执行。
2. 确认可用内存高于计划 JVM 堆，并保留原生内存和宿主应用余量。4 GiB 是当前脚本的堆配置，不是完整机器内存规格。更小堆只能作为另行记录的隔离试验，尚未验证，不能承诺 2 GiB 可以稳定运行。
3. 确认隔离环境的实际监听地址、端口、初始账号、通知及外部连接策略，再启动；本机或隔离容器的监听限制须实际核验。当前未开启 Docker 引擎、未改防火墙、未启动平台。
4. 先核验平台 HTML 与认证模式 API，再验证测试账号登录、服务发现、表单保存及流程执行。最后单独验证数据库连接与事务。任何一项失败都保留独立结果，不用首页可达代替完整联调。

本次未安装任何全局组件、未下载大运行包、未构建平台、未修改 O2OA 源码。

## 4. MariaDB 暂定选择与实测

用户最新将数据库暂定为 MariaDB，并授权测试时自行启动现有服务。该决定不等于生产数据库配置或 JDBC 兼容性已经确认。

| 项目 | 实测 |
| --- | --- |
| Windows 服务名 | `MariaDB` |
| 版本 | 程序 `--version` 返回 `12.3.2-MariaDB`，Win64 AMD64 |
| 安装程序 | `C:\Program Files\MariaDB 12.3\bin\mysqld.exe` |
| 服务配置来源 | 注册服务参数指向 `C:\Program Files\MariaDB 12.3\data\my.ini` |
| 配置端口 | 3306；服务端／客户端相关行相同 |
| 初始及当前状态 | `Stopped`，手动启动类型；3306／3307 未发现监听 |
| 启动尝试 | 用户已授权后执行 `Start-Service -Name MariaDB`；返回 `Cannot open 'MariaDB' service on computer '.'`，未能启动 |
| 当前阻碍 | 当前进程不能控制该 Windows 服务；没有尝试提权、UAC 或绕开服务启动第二个实例 |
| 凭据 | 所读配置未发现 user/password 键；没有尝试猜测登录、重置密码或使用源码示例凭据 |
| 数据操作 | 未连接、未执行 SQL、未创建或改动现有库，未修改服务启动类型 |

数据库工具：[Test-MariaDb.ps1](../../deployment/dev/Test-MariaDb.ps1)。默认只读检查；显式 `-StartService` 才尝试正常服务启动，不能自动提升权限。`-RequireRunning` 要求服务和相应 PID 的监听端口均存在。即便服务启动成功，该结果仍不包含认证连接和 JDBC 验证。

[ExternalDataSource.java](../../o2server/x_base_core_project/src/main/java/com/x/base/core/project/config/ExternalDataSource.java) 中存在 MySQL JDBC URL 默认示例；这不能证明当前 fork 的实际 JDBC 驱动、OpenJPA 方言和 MariaDB 12.3.2 已兼容。之后需要在有授权测试账号和独立测试库时核对驱动／方言版本、字符集、金额精度、时区、建表和基本事务，再记录结论。当前保留为**未验证**。

## 5. 脚本验证记录及范围

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| 两份 PowerShell 脚本语法解析 | 通过 | PowerShell 7 parser，无语法错误 |
| O2OA Inspect 实机执行 | 通过 | 正确报告工具缺失、Docker 引擎不可用、55 模块、0 编译产物、发布结构缺失；诊断退出 0 不代表平台已就绪 |
| MariaDB 默认检查实机执行 | 通过 | 正确读出版本、服务、配置来源、3306 和 Stopped；无凭据输出与数据库写入 |
| 合成 HTTP fixture：平台形状 HTML＋认证模式 JSON | 识别通过 | 临时 Node 回环服务，明确是脚本自身的合成测试，不是真实 O2OA；`httpSmokePassed=true` 仅表示形状识别成功，平台启动及生产就绪仍为 false |
| 合成 HTTP fixture：普通 HTML | 正确拒绝 | 即使返回 200 也不标记通过；子进程退出码实测为 2 |
| 未启动地址探测 | 正确报告失败 | `httpSmokePassed=false`，没有把连接失败当成功 |

合成 fixture 验证结束后已停止。HTTP 探测只有 GET、不跟随重定向、不走代理、不接受外部主机地址、不输出响应正文。它证明探测器可工作，不能证明真实平台、身份认证、公司隔离、流程或 MariaDB 已运行。

后续完整接入仍须覆盖[改造方案](../architecture/02-o2oa-adaptation-plan.md)的平台验证门槛及[验收计划](01-acceptance-plan.md)。本轮真实平台／MariaDB 联调缺口保持开放。
