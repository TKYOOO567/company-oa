# 0002：MariaDB utf8mb4 下查询条目复合索引兼容

状态：字典实现与单元回归通过；真实数据库建索引、流程发起与重启验证由隔离联调结果补充。日期：2026-10-24。

## 原因与来源

基于本仓库导入的 O2OA 源码，来源提交为 `0b328b1cd88e221d25a6188f47b3d6e08de69fbe`，见 [来源记录](../../upstream.json)。本次修复服务于 Web 第一版的真实 MariaDB 联调，不改变审批业务规则。

`x_query_core_entity` 中 `Item` 声明的普通索引 `QRY_ITEM_stringShortValue` 包含 `xbundle`、`xstringShortValue` 两个 255 字符列及四个 128 字符 path 列。utf8mb4 最大索引键长为 `(255 + 255 + 4 × 128) × 4 = 4088` 字节，超过本次 MariaDB/InnoDB 实例报出的 3072 字节上限，导致首次使用此实体时自动建索引失败。源码常量名中的 `B` 不会令 JPA 的 `Column.length` 变为数据库字节长度。

OpenJPA 3.2.2 的 MySQL/MariaDB 字典没有列前缀长度配置；继承的 `getCreateIndexSQL()` 直接生成完整列索引。[OpenJPA 3.2.2 实现](https://github.com/apache/openjpa/blob/3.2.2/openjpa-jdbc/src/main/java/org/apache/openjpa/jdbc/sql/DBDictionary.java#L3565-L3586)

MariaDB 12.3.2 为过长 UNIQUE 键提供的长 HASH 路径不适用于这个普通索引；普通索引超长仍会报错，不能通过改变唯一性绕过。[MariaDB 12.3.2 实现](https://github.com/MariaDB/server/blob/mariadb-12.3.2/sql/sql_table.cc#L2923-L2975)

## 修改边界

新增 `com.x.base.core.openjpa.jdbc.sql.CompanyOaMySQLDictionary`，继承既有 `MySQLDictionary`，通过原有 `ExternalDataSource.dictionary` 插件入口显式选用；不替换所有数据库的默认字典，不改实体注解、列定义、表字符集、查询谓词或数据值。

仅在表名、索引名、六列的名称与顺序均匹配上述索引，列为有明确正长度的 CHAR/VARCHAR，索引非唯一，且按每字符最多 4 字节估算超过 3072 时，为长度超过 128 的列生成 128 字符索引前缀。当前实体生成：

```sql
CREATE INDEX QRY_ITEM_stringShortValue ON QRY_ITEM
  (xbundle(128), xstringShortValue(128), xpath0, xpath1, xpath2, xpath3)
```

当前物理键最多 `6 × 128 × 4 = 3072` 字节；两列仍为 VARCHAR(255)，四个 path 仍为 VARCHAR(128)。完整 WHERE 比较保留，结果仍按完整值核验。前缀索引可能降低选择性，并影响覆盖索引及排序性能，未宣称性能等同完整索引。[MariaDB 索引定义](https://mariadb.com/docs/server/server-usage/tables/create-table#index-definitions)

其他索引和任何 UNIQUE 索引均返回原字典 DDL；不会截短唯一键、删除索引或关闭索引创建。`QRY_ITEM_bundle` 原键最多 3068 字节，不受影响。对未来不符合已核实列签名的结构保留原行为，使其显式暴露兼容问题。

## 构建与验证

修改文件为 `o2server/x_base_core_project` 下新增的字典类与 `CompanyOaMySQLDictionaryTest`。重编 shared core JAR 即可，不需要更改业务模块 API。工具命令在工程根执行：

```powershell
pwsh -NoProfile -File deployment/dev/Sync-O2ConsoleSource.ps1 -Module x_base_core_project -BuildRoot '<已有源码快照目录>'
pwsh -NoProfile -File deployment/dev/Build-O2Source.ps1 -Stage CoreBuild -BuildRoot '<已有源码快照目录>'
```

`CoreBuild` 明确运行外部数据源启用回归与本字典回归，成功后产生 shared core JAR、Surefire 报告、阶段日志与 receipt。运行目录停止后再替换对应的 `store/jars/x_base_core_project.jar`，并核对 SHA256；构建脚本不启动服务或访问数据库。源码快照的 manifest 与 source-overrides 同步记录新输入。

字典单测覆盖：超限索引前缀 DDL及原列长度不变、UNIQUE 语义不被改写、3072 边界与其他索引保持原 DDL、异常列签名保持原 DDL。2026-10-24 01:22:04 的 `CoreBuild` 实跑字典 4 项及外部数据源 2 项，6 项全部通过，失败、错误和跳过均为 0；单测使用真实 OpenJPA 配置生命周期，不访问数据库。真实 MariaDB 验证须确认索引存在及 SUB_PART、列字符集/长度、相同前缀不同后缀数据的全值查询结果，以及实际流程发起与持久化重启。

## 升级与删除条件

真实验证已在全新独立 MariaDB 12.3.2 库完成：平台自动创建该索引，实际 SUB_PART 为 128／128／NULL／NULL／NULL／NULL，两原列仍为 VARCHAR(255) utf8mb4。事务内的两行共享128字符索引前缀，完整 WHERE 各只返回自身；中文四字节字符保存通过，ROLLBACK 后探针行数为0。平台合成审批与数据库／平台双重启后的业务数据回读均通过，重启后再次核对该索引仍通过。初次失败库缺少该索引，未作为成功证据。命令为 `Test-MariaDbIndex.ps1 -RuntimeRoot <隔离运行目录>`，详见[运行报告](../../docs/verification/platform-runtime.md)。

升级 OpenJPA/O2OA 时重新核对实体列签名和索引生成行为。若上游已支持 utf8mb4 索引预算，可对比回归与真实数据库测试后删除此类及显式字典配置。已有数据库的物理索引变更须作为独立数据库迁移评估，不能仅删除配置或重建业务表；保留真实数据、完整字段和唯一约束。
