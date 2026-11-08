<p align="center">
  <a href="./README.md">English</a> · <a href="./README.ru.md">Русский</a> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="./assets/readme/hero.png" width="100%" alt="Voxellume 体素景观，以及真实 Fabric 客户端和确定性场景的截图">
</p>

Voxellume 是一个采用 MIT 许可证的公开智能体能力，用于将 Minecraft Java 模组从想法转化为经过审查、可复现的交付物。它在 OMP、DeepSeek Harness 和 MCP 中统一提供精确目标包、可编辑源码与美术资源、安全执行和证据驱动的验证。

## 证据，而非承诺

目录覆盖全部 68 个 Minecraft/loader 组合：**52 个候选、15 个已拒绝、1 个不支持、0 个 supported**。当前基线已经能够生成真实工件和真实客户端证据。它不会宣称普遍兼容，也不会把未执行的检查算作通过。

| 基线                   | 已执行的证据                                                                                                   | 状态                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Fabric 1.21.1 r2**   | 干净构建、专用服务器、必需的 GameTest、生产 JAR、真实客户端与固定 seed 截图、全新 packaged-JAR 服务器          | **候选** — world/inventory/animation 矩阵和 packaged-JAR 客户端尚未完成 |
| **NeoForge 1.21.1 r2** | 二进制流水线干净构建、两个正向 GameTest 及一个故意失败的控制组、专用与 packaged-JAR 服务器、真实客户端模组列表 | **候选** — packaged-JAR 客户端和完整视觉矩阵尚未完成                    |
| **Quilt 1.21.1 r2**    | 干净构建、专用服务器、生产 JAR                                                                                 | **候选** — GameTest 不可用；真实客户端检查超时                          |
| **Forge 1.21.1 r1**    | 已核对精确 MDK 和工件身份；反编译超出强制 4 GiB 沙箱限制                                                       | **已拒绝** — 没有生产 JAR，也不声明运行时支持                           |

每条记录都包含精确命令、工件哈希、日志、沙箱限制和明确的不可用结果。

## 一个引擎，三种宿主

所有宿主都使用同一个 `CoreOperations` 外观。模型输入绝不能提供目标包、验证策略或它自己的文件系统权限。

```text
minecraft_target_resolve
minecraft_project_inspect
minecraft_project_scaffold
minecraft_assets_validate
minecraft_project_verify
```

每个宿主都返回相同且带版本号的 `DomainResult<T>`，其中包含稳定的错误码、是否可重试、详细信息和证据引用。

| 宿主                 | 原生契约                                                              |
| -------------------- | --------------------------------------------------------------------- |
| **OMP**              | 扩展工具、标准 skills、智能体和命令                                   |
| **DeepSeek Harness** | 外部 Cordis bundle、类型化工具、托管验证任务、共享 system prompt      |
| **MCP**              | 官方 TypeScript server v2（stdio）、严格的 Zod 输入、受限的结构化输出 |

## 工作流程

自然语言请求会转换为带版本号的 **ModSpec**：模组标识、精确目标修订、功能、可编辑资源、验收检查和交付设置。所有宿主调用同一个核心流水线，因此 OMP、Harness 和 MCP 返回等价结果，而不是维护不同实现。

1. **精确解析目标。** Resolver 匹配 Minecraft、loader、mappings、JDK、Gradle 和不可变的目标包哈希。只有完整通过验证的 `supported` 包才能创建新项目。`candidate`、`rejected` 和 `unsupported` 会在修改项目或 Git 之前停止；绝不用相近版本替代。
2. **验证请求的更改。** 严格的 schema 将每个功能连接到 implementation units 和独立验收检查。操作使用稳定的功能 ID，而不是任意文件路径或 shell 命令。
3. **在事务中工作。** 宿主授予 filesystem roots。智能体只编辑 staging 副本；项目锁、基础哈希、日志、取消和 last-good 回滚会保护正式项目与无关文件。
4. **生成可编辑源码和资源。** Java、JSON、PNG 和 `.bbmodel` 源文件始终与运行时导出关联。Manifest 记录源文件/导出哈希、生成设置、上游修订、许可证和声明。
5. **按策略执行。** 验证使用目标包中固定的 argv、受限进程、隔离缓存和 build/runtime 沙箱。模型文本不能选择可执行文件、自行授予路径或继承仓库凭据。
6. **按依赖顺序验证。** `static → build → server → gameTest → client → productionJar → visual → package`。失败、取消、超时或不可用的阶段会阻止后续成功声明并如实记录，绝不会变成 pass。
7. **连同证据交付。** 合格结果包含生产 JAR、源码归档、可编辑资源、ModSpec、校验和、复现命令和独立 evidence bundle。Commit、push 和 PR 仍是受信任宿主的独立操作。

## 安装与验证

### 1. 安装共享包

要求：Node.js `>=24.9.0`、带 pnpm `12.18.0` 的 Corepack，以及用于 1.21.x 目标的 JDK 21 或用于 26.x 目标的 JDK 25。沙箱中的构建和运行时检查还需要 Docker。

```sh
git clone https://github.com/lukavtz/voxellume.git
cd voxellume
./install.sh
```

安装脚本会按照 lockfile 安装依赖，构建精确的 `voxellume-0.1.0.tgz`，并全局安装使用标准输入输出的 `voxellume-mcp` 命令。如果 pnpm 全局可执行文件目录不在 `PATH` 中，脚本会显示其位置。

### 2. 连接所需宿主

**OMP 18.17.0** — 需要 Bun `>=1.4.4`：

```sh
omp plugin link "$PWD" --scope project
omp plugin list --json
```

**DeepSeek Harness 0.2.2-rc.1** — 将精确 tarball 安装到隔离配置中，并禁用包安装脚本：

```sh
dsh plugin --profile voxellume-test add ./voxellume-0.1.0.tgz \
  --ignore-scripts --config.auto-install-peers=false
dsh --profile voxellume-test --dump-config
```

**原生 MCP** — 运行 `voxellume-mcp`，或在 MCP 客户端中将其注册为标准输入输出服务器：

```json
{
  "mcpServers": {
    "voxellume": {
      "command": "voxellume-mcp"
    }
  }
}
```

本地核心操作不需要 TCP 监听器、模型凭据或托管服务。只有执行相应检查时，才需要 Docker、JDK 和可选资源提供程序。

### 3. 验证安装

交付前运行确定性检查：

```sh
corepack pnpm verify
corepack pnpm test
corepack pnpm test:e2e
node scripts/ci/validate-workflows.mjs
```

最新本地结果：**1073/1073 项测试**和 **20/20 项端到端检查**，包括真实安装 OMP `18.17.0` 与 DeepSeek Harness `0.2.2-rc.1`。CI 在 Ubuntu、macOS 和 Windows x64 上运行核心与对抗性测试；目标单元和供应链扫描由独立检查执行。

## 当前边界

- 全部 68 个目标单元都有明确结果，但目前 **0 个为 `supported`**；在目标完成完整资格矩阵之前，新项目脚手架保持禁用。
- 完整的真实客户端、packaged JAR 和视觉验证尚未完成。必需的检查不可用时，将阻止 `supported`。
- Source facade 已禁用，因为两个候选实现都未通过正确性和安全性基准测试。
- 没有经过单独验证的工作流时，Quilt GameTest 仍不可用。
- 本仓库公开并采用 MIT 许可证。第三方修订、许可证、修改和声明记录在 `THIRD_PARTY/` 和 `support-manifest.json` 中。

## 深入阅读

- [产品规范](./docs/SPEC.md)
- [架构与信任边界](./docs/ARCHITECTURE.md)
- [验证计划](./docs/TEST_PLAN.md)
- [宿主契约](./docs/research/host-contracts.md)
- [端到端场景与测量结果](./docs/research/e2e-benchmarks.md)
- [CI 工作流与操作系统覆盖](./docs/research/ci-workflows.md)
- [沙箱视觉运行时](./docs/research/visual-qualification-image.md)
- [目标包哈希与验证链接](./support-manifest.json)

## 许可证

[MIT](./LICENSE)。第三方组件保留其各自的许可证和声明。
