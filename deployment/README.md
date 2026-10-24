# 部署与运行准备

目标为公司控制的云服务器，通过互联网登录使用。当前已有 [本机开发环境预检](dev/README.md) 与新 Web 开发服务，尚未部署云主机或启动真实 O2OA。数据库暂定 MariaDB，实际服务控制及连接缺口见[平台运行报告](../docs/verification/platform-runtime.md)。

后续模板与说明需要覆盖：

1. 固定平台版本、构建来源、JDK/Maven/Node 等实际依赖和构建产物。
2. Web 与平台服务的访问方式、反向代理、HTTPS、认证会话及接口代理。
3. 生产数据库、附件存储、访问控制、备份、恢复和监控。
4. 开发、验证和生产环境区别，密钥与实际环境变量的注入方式。
5. 升级、迁移、在途业务切换、回退条件及验证证据。

源码当前要求 Java 11；构建链使用 Maven 和 Gulp。上游准备脚本会下载运行组件，Windows 启动脚本默认配置 4GB JVM 堆。这里只记录静态观察，不据此认定资源规格、数据库或部署拓扑已经选定或验证。

只提交脱敏模板和操作说明。真实密钥、数据库、备份及运行配置保留在部署环境或忽略的 `.local/` 中。

参见 [改造方案](../docs/architecture/02-o2oa-adaptation-plan.md)、[验收计划](../docs/verification/01-acceptance-plan.md) 和 [迁移策略](../docs/migration/01-migration-strategy.md)。
