# Company OA

基于 O2OA 的公司内部协同办公系统改造工程。本期先做 Web，Android 单独后续推进。

- [项目文档入口](docs/README.md)
- [目录与开发约束](AGENTS.md)
- [需求范围](docs/requirements/01-scope-and-requirements.md)
- [业务流程](docs/requirements/02-business-processes.md)
- [O2OA 改造方案](docs/architecture/02-o2oa-adaptation-plan.md)
- [迁移策略](docs/migration/01-migration-strategy.md)
- [尚未执行的验收计划](docs/verification/01-acceptance-plan.md)
- [上游来源与固定提交](upstream.json)

当前阶段：模块化 Web 第一版。工作台、平台登录、待办／已办、搜索、详情及原生 MWF 字段已与本仓库源码构建的 O2OA、独立 MariaDB 完成真实联调，并通过审批完成及两端重启持久化验证。运行方式见 [Web 工程](apps/oa-web/README.md)、[隔离运行工具](deployment/dev/README.md)，证据与边界见 [v0.1 验证记录](docs/verification/web-v0.1.md)。旧业务、公司权限、正式财务及历史迁移仍未验收。

本仓库是唯一开发目录。所需 fork 源码已包含在 `o2server/`、`o2web/` 等上游目录中；新 Web、扩展、配置与迁移工具均按[目录规范](docs/architecture/01-repository-and-directories.md)在本仓库维护，无需额外的本地 fork 检出。

仓库为 [TKYOOO567/company-oa](https://github.com/TKYOOO567/company-oa)，按用户要求公开。保留原 fork 的 [LICENSE](LICENSE) 与版权说明，沿用 AGPL-3.0；以下继续保留上游项目说明。

---

<p align="center">
	<a target="_blank" href="https://github.com/o2oa/o2oa/blob/develop/LICENSE"><img alt="GitHub license" src="https://img.shields.io/github/license/o2oa/o2oa"></a>
	<a target="_blank" href="https://www.oracle.com/technetwork/java/javase/downloads/index.html">
		<img src="https://img.shields.io/badge/JDK-11-green" />
	</a>
	<a target="_blank" href="https://gitee.com/o2oa/O2OA/stargazers">
		<img src="https://gitee.com/o2oa/O2OA/badge/star.svg?theme=dark" alt='gitee star'/>
	</a>
	<a target="_blank" href="https://github.com/o2oa/o2oa/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/o2oa/o2oa?style=social"></a>
</p>


----------------------------------------------------------------------------

# O2OA（翱途）开发平台（100%开源的OA与协同办公解决方案）

O2OA（翱途）低代码开发平台，100%开源企业协同办公定制平台，提供完整的前后端API和模块定制能力。平台基于JavaEE分布式架构，具备流程引擎、表单定制、页面定制能力及业务数据服务能力，支持跨平台移动办公，有效提升工作效率。

平台通过国产信创认证，支持白标二次开发，提供高度灵活的协同办公解决方案，低成本满足企业办公需求。低代码开发大幅降低技术门槛，加速系统构建与定制，赋能企业快速响应业务实现，确保信息安全与自主可控。

![o2oa](https://www.o2oa.net/v3/img/home/pic_zonghe@2x.png)



# 官方网站:

开源主页 : https://www.oschina.net/p/o2oa

官方网站 : http://www.o2oa.net

官方论坛 : https://forum.o2oa.net/


# 关于正式环境数据安全相关的建议:

O2OA自带的H2数据库是一个内嵌式的内存数据库，适合用于开发环境、功能演示环境，并不适合用作正式环境。

如果作为正式环境使用，建议您使用拥有更高性能，更加稳定的商用级别数据库。如Mysql8，Oracle12C，SQLServer 2012等。

另外，O2OA提供数据定期备份和恢复的能力，建议您开启正式环境的数据定期备份的功能，以确保数据库异常时可以进行数据恢复。



# 支持操作系统：

```shell
Windows 64Bit, Linux 64Bit[CentOS, RedHat, Ubuntu等], MacOS, AIX, Raspberrypi(树莓派), ARM_Linux, MIPS_Linux, UOS,麒麟等国产操作系统
```



# 平台使用手册：

https://www.o2oa.net/handbook.html



# 源码编译教程:

https://www.o2oa.net/cms/source/335.html



# 服务器部署教程：

Windows环境：https://www.o2oa.net/cms/serverdeployment/694.html

Linux环境：https://www.o2oa.net/cms/serverdeployment/468.html



# How to Start

## windows

1.下载o2server. yyyyMMddHHmmss_ windows.zip程序包。

2.解压下载后的压缩包到任意目录。

3.确认开通服务器的80、20020、20030端口。

4.打开o2server文件夹,选择start_ windows.bat双击打开。

5.启动服务,等待相关服务自动完成。

6.自动完成后打开浏览器访问http://127.0.0.1。


## linux

1.下载o2server. yyyyMMddHHmmss_linux.zip程序包。

2.确认开通服务器的80、20020、20030端口。

3."unzip o2server. syyyMMddHHmmss linux.zip" 解压程序包。

4."cd o2server. yyyMMddHHmmss_ linux" 进入解压目录。

5."cd o2server"进入程序目录。

6."./start. linux.sh" 回车启动服务器控制台。

7.启动服务,等待相关服务自动完成。

8.自动完成后打开浏览器访问http://127.0.0.1。



#### 若开发者学习研究O2OA，企业在O2OA应用开发平台上建设内部使用的办公系统，不闭源分发版本，不参与商业项目的使用行为不会构成侵权风险。

#### 如果需要进行转售，闭源分发或者在商业项目中作为项目的一部分使用，请主动联系兰德网络公司购买商用许可。

商用许可与支持服务：https://www.o2oa.net/service/gs.html



# 协议

[AGPL-3.0 开源协议。](./LICENSE)



# 关于

[![img](https://www.o2oa.net/v3/img/common/logo_all@2x.png)](./assets/O2OA-logo.jpg)

浙江兰德纵横网络技术股份有限 公司成立于1999年，是浙江省高新技术企业、浙江省信息产业厅认定的软件企业、浙江省信息产业重点企业、浙江省软件业五强企业， 总部拥有5300多平方米的办公场所，员工总数超过600人，在北京、上海、深圳、天津、南京、合肥、郑州、重庆、沈阳、长春、哈尔滨、呼和浩特、济南、南昌等省会城市设立办事处， 服务网络覆盖中国及东南亚部分国家和地区。公司已通过ISO9001：2008国际质量体系认证，并取得了国家系统集成三级资质认证和CMI三级认证的证书。

兰德网络是信息技术应用与服务提供商，为客户的计算机信息系统、企业级通信系统的建设提供解决方案和专业化服务。 业务包括：项目咨询、方案设计、应用系统开发、企业信息系统等服务。

兰德网络在电信运营企业中拥有良好的品牌形象，我们的通信软件系列产品已广泛应用于中国电信、中国移动、中国联通和中国网通等广大电信运营商的通信系统。 兰德网络已成为中国无线信息服务产业中优秀的商业机构及系统提供商代表，并将成为信息产业、互联网和数据通信服务产业中杰出的系统与服务提供商代表。

面向未来，兰德网络的愿景是“致力于更加美好的协作”。我们相信人类的协作一定会有更加美好的图景，等待我们去探索和描绘！



O2OA（翱途）开发平台是由 **浙江兰德纵横网路技术股份有限公司** 建立和维护的。O2OA（翱途）的名字和标志是属于 **浙江兰德纵横网路技术股份有限公司** 的注册商标。

我们 ❤️ 开源软件！看一下[我们的其他开源项目](https://github.com/o2oa)，瞅一眼[我们的博客](https://my.oschina.net/o2oa)。


