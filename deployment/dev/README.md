# 本机开发环境预检

本目录工具用于 Windows / PowerShell 7。当前提供环境预检、本机只读 HTTP 探测及 MariaDB 服务检查，不负责安装、构建或启动 O2OA。详细实测结果见[平台运行报告](../../docs/verification/platform-runtime.md)。所有实际发布包、运行配置、数据库材料和日志放在工程内忽略目录 `.local/`。

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

脚本读取注册服务的程序及配置路径、版本、端口，并核对监听进程是否属于该服务；不猜测凭据、不登录、不建库、不执行 SQL，也不输出密码值。`-RequireRunning` 下服务与端口未确认时退出 2。当前会话尝试启动服务因 Windows 服务控制权限不足而失败，详见报告。
