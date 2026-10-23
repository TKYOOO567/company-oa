# Company OA 项目文档

记录日期：2026-10-23，Asia/Shanghai。

本工程用于在 O2OA 基础上全面替换现用纷享销客。2026-10-24 已完成模块化 Web 第一版及源码 O2OA／独立 MariaDB 的真实最小链路验证，涵盖正常账号、待办、原生 MWF 中文字段、审批完成和重启持久化。原业务流程、公司权限、正式账务和真实数据迁移仍未验收。

## 阅读顺序

| 文档 | 内容 |
| --- | --- |
| [开发约束](../AGENTS.md) | 后续开发的入口和执行规则 |
| [需求范围与需求清单](requirements/01-scope-and-requirements.md) | 已确认目标、范围和需求编号 |
| [业务流程与数据关系](requirements/02-business-processes.md) | 收入、支出、员工费用、会计及配置变更逻辑 |
| [待确认事项](requirements/03-open-questions.md) | 业务决定、技术核实事项及解决方式 |
| [机器可读基线](requirements/baseline.json) | 已确认要求与来源证据，供后续追踪 |
| [仓库与目录规范](architecture/01-repository-and-directories.md) | 目录职责、源码与配置的放置规则 |
| [基于 O2OA 的改造方案](architecture/02-o2oa-adaptation-plan.md) | 复用边界、前端接入、阶段产物和退出标准 |
| [ADR 0001：扩展策略](architecture/adr/0001-o2oa-extension-strategy.md) | 当前架构约定及尚未确定的选型 |
| [ADR 0002：Web 第一版](architecture/adr/0002-web-foundation.md) | 前端技术栈、模块划分、演示与真实连接边界 |
| [Web v0.1 验证](verification/web-v0.1.md) | 本轮实现、运行方式、检查结果及缺口 |
| [平台运行调查](verification/platform-runtime.md) | O2OA 环境与 MariaDB 服务实测 |
| [迁移策略](migration/01-migration-strategy.md) | 源数据提取、字段映射、关系恢复、试迁移及核对 |
| [对象盘点](migration/object-inventory.json) | 已观察对象的部分目录，尚非完整 schema |
| [字段映射样例](migration/field-mapping.sample.json) | 付款申请字段的文档映射示例 |
| [验收计划](verification/01-acceptance-plan.md) | 验收用例及证据要求，当前尚未执行 |
| [源码来源](../upstream.json) | 来源仓库、分支及固定提交 |

## 状态口径

- **用户确认**：本次访谈中用户明确选择或说明的要求。
- **页面／源码观察**：已经看到的配置和代码事实，不代表已联调或验收。
- **方案约定**：此次规划采用的目录与改造方式，可以经后续事实更新。
- **待确认／待验证**：不得作为已具备能力、已完成迁移或既定财务规则使用。

旧系统页面显示 132 个自定义对象、固定审批列表 60 条，付款申请 94 个字段。它们是盘点起点，不代表已经逐项核对或全部导出。正式会计账的启用、期初、补账和总部口径仍有待确认项。

## 本期边界

先做 Web，Android 单独推进；部署目标是公司控制的云服务器并支持互联网登录。没有固定截止日期，以业务、权限、财务、迁移和切换验证通过为上线依据。目录占位说明和规划文件均不代表业务代码已经实现。
