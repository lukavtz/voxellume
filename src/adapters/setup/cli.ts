#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

import { ArchiveError, downloadVerified, extractTarGz } from "./archive.ts";

export const BLOCKBENCH_MCP_VERSION = "1.10.1";
export const BLOCKBENCH_MCP_REVISION =
  "97a8a80d3a37bf95c5e136d93d2c7da399fff753";
export const BLOCKBENCH_MCP_ARCHIVE = Object.freeze({
  url: `https://codeload.github.com/jasonjgardner/blockbench-mcp-plugin/tar.gz/${BLOCKBENCH_MCP_REVISION}`,
  sha256: "d3773f5ef893f8371428bc0e33c82684b3ec81c1b53ff5f99381cf4aca2401b3",
});
export const BLOCKBENCH_DESKTOP_ARCHIVE = Object.freeze({
  version: "5.2.2",
  linux: {
    url: "https://github.com/JannisX11/blockbench/releases/download/v5.2.2/Blockbench_5.2.2.deb",
    sha256: "76ea903a2d0086a112f177586efdeba9a1a87ea0218b2f1bbb4b2dc3ce177031",
  },
  darwinArm64: {
    url: "https://github.com/JannisX11/blockbench/releases/download/v5.2.2/Blockbench_arm64_5.2.2.dmg",
    sha256: "0d072bf863ee3e0bcaecbd0de67a5ffd29dfbf6ee2e8fe5eeb872a14331c5c03",
  },
  darwinX64: {
    url: "https://github.com/JannisX11/blockbench/releases/download/v5.2.2/Blockbench_x64_5.2.2.dmg",
    sha256: "d743fa5d92db3e5081a450ca91ab0536c7a62ac12b9c1a7374040e2524a15469",
  },
  windowsWingetId: "JannisX11.Blockbench",
});
export const DESKTOP_PLUGIN_URL =
  "https://jasonjgardner.github.io/blockbench-mcp-plugin/mcp.js";

export type SetupLanguage = "en" | "ru" | "zh-CN";

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly echo?: boolean;
}

export interface ArchivePin {
  readonly url: string;
  readonly sha256: string;
}

interface Output {
  write(text: string): boolean;
}

export interface SetupCliDependencies {
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly home?: string;
  readonly dataHome?: string;
  readonly tempRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly nodeVersion?: string;
  readonly osRelease?: string;
  readonly archive?: ArchivePin;
  readonly blockbenchArchive?: ArchivePin;
  readonly stdout?: Output;
  readonly stderr?: Output;
  readonly prompt?: (question: string) => Promise<string>;
  readonly checkFile?: (paths: readonly string[]) => Promise<string | null>;
  readonly runCommand?: (
    command: string,
    args: readonly string[],
    options?: CommandOptions,
  ) => Promise<CommandResult>;
  readonly fetch?: typeof fetch;
}

interface Check {
  readonly id:
    | "node"
    | "npx"
    | "docker"
    | "jdk21"
    | "jdk25"
    | "blockbench"
    | "blender"
    | "ffmpeg";
  readonly installed: boolean;
  readonly detail: string;
  readonly action: string;
}

interface Context {
  readonly lang: SetupLanguage;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly home: string;
  readonly dataHome: string;
  readonly tempRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly nodeVersion: string;
  readonly osRelease: string;
  readonly archive: ArchivePin;
  readonly blockbenchArchive: ArchivePin;
  readonly stdout: Output;
  readonly stderr: Output;
  readonly prompt?: (question: string) => Promise<string>;
  readonly checkFile: (paths: readonly string[]) => Promise<string | null>;
  readonly runCommand: (
    command: string,
    args: readonly string[],
    options?: CommandOptions,
  ) => Promise<CommandResult>;
  readonly fetch: typeof fetch;
  readonly signal: AbortSignal;
}

const messages = {
  en: {
    heading: "Voxellume environment check",
    installed: "installed",
    missing: "missing",
    next: "Next",
    confirm:
      "Install missing prerequisites and prepare the Blockbench MCP root? [y/N] ",
    cancelled: "Setup cancelled; nothing was changed.",
    installing:
      "Installing missing prerequisites with the host package manager.",
    manual:
      "Some prerequisites could not be installed automatically. Follow the actions above.",
    installingMcp: "Installing pinned Blockbench MCP 1.10.1.",
    ready: "Blockbench MCP is ready. No server was launched.",
    stdio: "MCP stdio configuration:",
    desktop: "Desktop Blockbench plugin (optional):",
    desktopCommand:
      "Load this URL in Blockbench > File > Plugins > Load Plugin from URL:",
    nodeAction:
      "Install Node.js 24.9.0 or newer: https://nodejs.org/dist/v24.9.0/",
    npxAction: "Install Node.js with npm/npx, then run: npx --version",
    dockerAction: "Install Docker, start its daemon, then run: docker version",
    jdk21Action:
      "Install JDK 21 and set JAVA_HOME_21 to its installation directory.",
    jdk25Action:
      "Install JDK 25 and set JAVA_HOME_25 to its installation directory.",
    blockbenchAction:
      "Install Blockbench 5.2.2: https://github.com/JannisX11/blockbench/releases/tag/v5.2.2",
    blenderAction: "Install Blender, then run: blender --version",
    ffmpegAction: "Install ffmpeg, then run: ffmpeg -version",
    usage:
      "Usage: voxellume doctor --lang en|ru|zh-CN\n       voxellume setup --lang en|ru|zh-CN [--yes] [--blockbench-mcp-root /absolute/models]",
    invalid: "Invalid arguments.",
    declined: "Only --lang en, ru, or zh-CN is supported.",
    failed: "Setup failed",
    hash: "Archive SHA-256 does not match the pinned release.",
    traversal: "Archive contains an unsafe path.",
    symlink: "Archive contains a forbidden symlink or link.",
    download: "Could not download a pinned release archive.",
    install: "A package or pnpm installation command failed.",
    package:
      "Installed package does not match blockbench-mcp 1.10.1 and its headless bin.",
    root: "--blockbench-mcp-root must be an absolute path.",
    unsupportedDistro: "Unsupported Linux distribution: ",
    unsupportedPlatform:
      "Automatic prerequisite installation is unsupported on this OS: ",
    packageManager: "Required package manager is unavailable: ",
  },
  ru: {
    heading: "Проверка окружения Voxellume",
    installed: "установлено",
    missing: "отсутствует",
    next: "Действие",
    confirm:
      "Установить недостающие компоненты и подготовить каталог Blockbench MCP? [y/N] ",
    cancelled: "Установка отменена; изменения не вносились.",
    installing:
      "Устанавливаю недостающие компоненты через системный менеджер пакетов.",
    manual:
      "Некоторые компоненты не удалось установить автоматически. Выполните действия выше.",
    installingMcp: "Устанавливаю закреплённую версию Blockbench MCP 1.10.1.",
    ready: "Blockbench MCP готов. Сервер не запускался.",
    stdio: "Конфигурация MCP stdio:",
    desktop: "Плагин для настольного Blockbench (необязательно):",
    desktopCommand:
      "Откройте в Blockbench: Файл > Плагины > Загрузить плагин по URL:",
    nodeAction:
      "Установите Node.js 24.9.0 или новее: https://nodejs.org/dist/v24.9.0/",
    npxAction: "Установите Node.js с npm/npx, затем выполните: npx --version",
    dockerAction:
      "Установите Docker, запустите его службу, затем выполните: docker version",
    jdk21Action: "Установите JDK 21 и укажите его каталог в JAVA_HOME_21.",
    jdk25Action: "Установите JDK 25 и укажите его каталог в JAVA_HOME_25.",
    blockbenchAction:
      "Установите Blockbench 5.2.2: https://github.com/JannisX11/blockbench/releases/tag/v5.2.2",
    blenderAction: "Установите Blender, затем выполните: blender --version",
    ffmpegAction: "Установите ffmpeg, затем выполните: ffmpeg -version",
    usage:
      "Использование: voxellume doctor --lang en|ru|zh-CN\n                 voxellume setup --lang en|ru|zh-CN [--yes] [--blockbench-mcp-root /absolute/models]",
    invalid: "Недопустимые аргументы.",
    declined: "Для --lang доступны только en, ru и zh-CN.",
    failed: "Ошибка установки",
    hash: "SHA-256 архива не совпадает с закреплённым выпуском.",
    traversal: "Архив содержит небезопасный путь.",
    symlink: "Архив содержит запрещённую символическую ссылку.",
    download: "Не удалось загрузить архив закреплённого выпуска.",
    install: "Команда менеджера пакетов или pnpm завершилась с ошибкой.",
    package:
      "Установленный пакет не соответствует blockbench-mcp 1.10.1 и его headless bin.",
    root: "--blockbench-mcp-root должен быть абсолютным путём.",
    unsupportedDistro:
      "Неподдерживаемый дистрибутив Linux (требуется Ubuntu): ",
    unsupportedPlatform:
      "Автоматическая установка зависимостей не поддерживается в этой ОС: ",
    packageManager: "Необходимый менеджер пакетов недоступен: ",
  },
  "zh-CN": {
    heading: "Voxellume 环境检查",
    installed: "已安装",
    missing: "缺失",
    next: "下一步",
    confirm: "安装缺失的依赖并准备 Blockbench MCP 模型目录？[y/N] ",
    cancelled: "安装已取消；未做任何更改。",
    installing: "正在通过系统包管理器安装缺失的依赖。",
    manual: "部分依赖无法自动安装。请按上面的说明操作。",
    installingMcp: "正在安装固定版本 Blockbench MCP 1.10.1。",
    ready: "Blockbench MCP 已就绪。未启动服务器。",
    stdio: "MCP stdio 配置：",
    desktop: "Blockbench 桌面插件（可选）：",
    desktopCommand: "在 Blockbench 中选择 文件 > 插件 > 从 URL 加载插件：",
    nodeAction:
      "安装 Node.js 24.9.0 或更新版本：https://nodejs.org/dist/v24.9.0/",
    npxAction: "安装包含 npm/npx 的 Node.js，然后运行：npx --version",
    dockerAction: "安装 Docker 并启动守护进程，然后运行：docker version",
    jdk21Action: "安装 JDK 21，并将 JAVA_HOME_21 设置为其安装目录。",
    jdk25Action: "安装 JDK 25，并将 JAVA_HOME_25 设置为其安装目录。",
    blockbenchAction:
      "安装 Blockbench 5.2.2：https://github.com/JannisX11/blockbench/releases/tag/v5.2.2",
    blenderAction: "安装 Blender，然后运行：blender --version",
    ffmpegAction: "安装 ffmpeg，然后运行：ffmpeg -version",
    usage:
      "用法：voxellume doctor --lang en|ru|zh-CN\n           voxellume setup --lang en|ru|zh-CN [--yes] [--blockbench-mcp-root /absolute/models]",
    invalid: "参数无效。",
    declined: "--lang 仅支持 en、ru 或 zh-CN。",
    failed: "安装失败",
    hash: "归档 SHA-256 与固定版本不匹配。",
    traversal: "归档包含不安全路径。",
    symlink: "归档包含禁止的符号链接。",
    download: "无法下载固定版本的归档。",
    install: "包管理器或 pnpm 安装命令失败。",
    package: "安装的软件包与 blockbench-mcp 1.10.1 及其 headless bin 不匹配。",
    root: "--blockbench-mcp-root 必须是绝对路径。",
    unsupportedDistro: "不支持的 Linux 发行版（需要 Ubuntu）：",
    unsupportedPlatform: "此操作系统不支持自动安装依赖：",
    packageManager: "所需的包管理器不可用：",
  },
} as const;

function versionAtLeast(value: string, major: number, minor: number): boolean {
  const match = /v?(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (match === null) return false;
  return (
    Number(match[1]) > major ||
    (Number(match[1]) === major && Number(match[2]) >= minor)
  );
}

async function defaultCheckFile(
  paths: readonly string[],
): Promise<string | null> {
  for (const path of paths) {
    try {
      await access(path, constants.R_OK);
      return path;
    } catch {
      // Try the next standard installation path.
    }
  }
  return null;
}

async function executeCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    if (options.echo === true) process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    if (options.echo === true) process.stderr.write(chunk);
  });
  const stop = () => {
    if (child.pid !== undefined && process.platform !== "win32") {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    } else {
      child.kill("SIGTERM");
    }
  };
  options.signal?.addEventListener("abort", stop, { once: true });
  const { promise, resolve: finish } = Promise.withResolvers<CommandResult>();
  child.once("error", (error: NodeJS.ErrnoException) => {
    finish({
      code: error.code === "ENOENT" ? 127 : 1,
      stdout,
      stderr: error.message,
    });
  });
  child.once("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
  try {
    return await promise;
  } finally {
    options.signal?.removeEventListener("abort", stop);
  }
}

function makeContext(
  lang: SetupLanguage,
  dependencies: SetupCliDependencies,
  signal: AbortSignal,
): Context {
  const home = dependencies.home ?? homedir();
  const platform = dependencies.platform ?? process.platform;
  const dataHome =
    dependencies.dataHome ??
    dependencies.env?.XDG_DATA_HOME ??
    process.env.XDG_DATA_HOME ??
    (platform === "win32"
      ? join(
          dependencies.env?.LOCALAPPDATA ?? process.env.LOCALAPPDATA ?? home,
          "voxellume",
        )
      : join(home, ".local", "share", "voxellume"));
  return {
    lang,
    platform,
    arch: dependencies.arch ?? process.arch,
    home,
    dataHome,
    tempRoot: dependencies.tempRoot ?? tmpdir(),
    env: dependencies.env ?? process.env,
    nodeVersion: dependencies.nodeVersion ?? process.version,
    osRelease: dependencies.osRelease ?? "",
    archive: dependencies.archive ?? BLOCKBENCH_MCP_ARCHIVE,
    blockbenchArchive:
      dependencies.blockbenchArchive ??
      (platform === "darwin"
        ? (dependencies.arch ?? process.arch) === "x64"
          ? BLOCKBENCH_DESKTOP_ARCHIVE.darwinX64
          : BLOCKBENCH_DESKTOP_ARCHIVE.darwinArm64
        : BLOCKBENCH_DESKTOP_ARCHIVE.linux),
    stdout: dependencies.stdout ?? process.stdout,
    stderr: dependencies.stderr ?? process.stderr,
    ...(dependencies.prompt === undefined
      ? {}
      : { prompt: dependencies.prompt }),
    checkFile: dependencies.checkFile ?? defaultCheckFile,
    runCommand: dependencies.runCommand ?? executeCommand,
    fetch: dependencies.fetch ?? fetch,
    signal,
  };
}

async function javaVersion(
  context: Context,
  release: 21 | 25,
): Promise<string | null> {
  const configured = context.env[`JAVA_HOME_${release}`];
  if (configured !== undefined) {
    const executable = join(
      configured,
      "bin",
      context.platform === "win32" ? "java.exe" : "java",
    );
    const result = await context.runCommand(executable, ["-version"], {
      signal: context.signal,
    });
    if (
      result.code === 0 &&
      new RegExp(`"${release}[."]`).test(`${result.stdout}${result.stderr}`)
    ) {
      return `${configured} (${result.stdout}${result.stderr})`.split(
        "\n",
      )[0] as string;
    }
  }
  if (context.platform === "darwin") {
    const home = await context.runCommand(
      "/usr/libexec/java_home",
      ["-v", String(release)],
      {
        signal: context.signal,
      },
    );
    if (home.code === 0 && home.stdout.trim() !== "") return home.stdout.trim();
  }
  const result = await context.runCommand("java", ["-version"], {
    signal: context.signal,
  });
  const output = `${result.stdout}${result.stderr}`;
  if (result.code === 0 && new RegExp(`"${release}[."]`).test(output)) {
    return output.split("\n")[0] as string;
  }
  return null;
}

async function doctor(context: Context): Promise<Check[]> {
  const node = await context.runCommand("node", ["--version"], {
    signal: context.signal,
  });
  const nodeVersion =
    node.code === 0 ? node.stdout.trim() : context.nodeVersion;
  const npx = await context.runCommand("npx", ["--version"], {
    signal: context.signal,
  });
  const docker = await context.runCommand(
    "docker",
    ["version", "--format", "{{.Server.Version}}"],
    {
      signal: context.signal,
    },
  );
  const blender = await context.runCommand("blender", ["--version"], {
    signal: context.signal,
  });
  const ffmpeg = await context.runCommand("ffmpeg", ["-version"], {
    signal: context.signal,
  });
  const blockbenchPaths =
    context.platform === "darwin"
      ? [
          "/Applications/Blockbench.app",
          join(context.home, "Applications/Blockbench.app"),
        ]
      : context.platform === "win32"
        ? [
            join(
              context.env.LOCALAPPDATA ?? join(context.home, "AppData/Local"),
              "Programs/Blockbench/Blockbench.exe",
            ),
            join(
              context.env.PROGRAMFILES ?? "C:/Program Files",
              "Blockbench/Blockbench.exe",
            ),
          ]
        : [
            "/usr/bin/blockbench",
            "/opt/Blockbench/blockbench",
            join(context.home, "Applications/Blockbench.AppImage"),
          ];
  const blockbench = await context.checkFile(blockbenchPaths);
  const [jdk21, jdk25] = [
    await javaVersion(context, 21),
    await javaVersion(context, 25),
  ];
  const text = messages[context.lang];
  const details = [
    [
      "node",
      versionAtLeast(nodeVersion, 24, 9),
      nodeVersion || text.missing,
      text.nodeAction,
    ],
    ["npx", npx.code === 0, npx.stdout.trim(), text.npxAction],
    ["docker", docker.code === 0, docker.stdout.trim(), text.dockerAction],
    ["jdk21", jdk21 !== null, jdk21 ?? "", text.jdk21Action],
    [
      "jdk25",
      docker.code === 0 || jdk25 !== null,
      docker.code === 0 ? "Pinned JDK 25 container image" : (jdk25 ?? ""),
      text.jdk25Action,
    ],
    [
      "blockbench",
      blockbench !== null,
      blockbench ?? "",
      text.blockbenchAction,
    ],
    [
      "blender",
      blender.code === 0,
      blender.stdout.split("\n")[0] ?? "",
      text.blenderAction,
    ],
    [
      "ffmpeg",
      ffmpeg.code === 0,
      ffmpeg.stdout.split("\n")[0] ?? "",
      text.ffmpegAction,
    ],
  ] as const;
  return details.map(([id, installed, detail, action]) => ({
    id,
    installed,
    detail,
    action,
  }));
}

function printDoctor(context: Context, checks: readonly Check[]): void {
  const text = messages[context.lang];
  context.stdout.write(`${text.heading}\n`);
  for (const check of checks) {
    const label =
      check.id === "jdk21"
        ? "JDK 21"
        : check.id === "jdk25"
          ? "JDK 25"
          : check.id === "node"
            ? "Node.js >=24.9"
            : check.id === "npx"
              ? "npx"
              : check.id === "blockbench"
                ? "Blockbench"
                : check.id === "ffmpeg"
                  ? "ffmpeg"
                  : check.id === "blender"
                    ? "Blender"
                    : "Docker";
    context.stdout.write(
      `[${check.installed ? text.installed : text.missing}] ${label}${check.detail === "" ? "" : `: ${check.detail}`}\n`,
    );
    if (!check.installed)
      context.stdout.write(`  ${text.next}: ${check.action}\n`);
  }
}

async function requireCommand(
  context: Context,
  command: string,
  args: readonly string[],
): Promise<void> {
  context.stdout.write(`$ ${command} ${args.join(" ")}\n`);
  const result = await context.runCommand(command, args, {
    signal: context.signal,
    echo: true,
    env: context.env,
  });
  if (result.code !== 0)
    throw new ArchiveError(
      "package_install_failed",
      `${command} ${args.join(" ")}`,
    );
}

async function requirePackageManager(
  context: Context,
  command: string,
): Promise<void> {
  const result = await context.runCommand(command, ["--version"], {
    signal: context.signal,
  });
  if (result.code !== 0)
    throw new ArchiveError("package_manager_unavailable", command);
}

async function installMac(
  context: Context,
  missing: ReadonlySet<string>,
  workspace: string,
): Promise<void> {
  await requirePackageManager(context, "brew");
  if (missing.has("blockbench")) {
    const image = join(workspace, "Blockbench_5.2.2.dmg");
    const mount = join(workspace, "blockbench-mount");
    const destination = join(context.home, "Applications", "Blockbench.app");
    await downloadVerified(
      context.blockbenchArchive.url,
      context.blockbenchArchive.sha256,
      image,
      context.fetch,
      context.signal,
      256 * 1024 * 1024,
    );
    await mkdir(mount, { recursive: true, mode: 0o700 });
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await requireCommand(context, "hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-mountpoint",
      mount,
      image,
    ]);
    try {
      await requireCommand(context, "ditto", [
        join(mount, "Blockbench.app"),
        destination,
      ]);
    } finally {
      await requireCommand(context, "hdiutil", ["detach", mount]);
    }
  }
  const formulae = [
    ...(missing.has("node") || missing.has("npx") ? ["node@24"] : []),
    ...(missing.has("docker") ? ["docker", "colima"] : []),
    ...(missing.has("jdk21") ? ["openjdk@21"] : []),
    ...(missing.has("jdk25") ? ["openjdk@25"] : []),
    ...(missing.has("ffmpeg") ? ["ffmpeg"] : []),
  ];
  if (formulae.length > 0)
    await requireCommand(context, "brew", ["install", ...formulae]);
  if (missing.has("node") || missing.has("npx"))
    await requireCommand(context, "brew", ["link", "node@24"]);
  if (missing.has("blender"))
    await requireCommand(context, "brew", ["install", "--cask", "blender"]);
  if (missing.has("docker"))
    await requireCommand(context, "colima", [
      "start",
      "--cpu",
      "4",
      "--memory",
      "8",
      "--disk",
      "60",
    ]);
}

async function installUbuntu(
  context: Context,
  missing: ReadonlySet<string>,
  yes: boolean,
  workspace: string,
): Promise<void> {
  let release = context.osRelease;
  if (release === "") {
    try {
      release = await readFile("/etc/os-release", "utf8");
    } catch {
      throw new ArchiveError("unsupported_distro", "unknown");
    }
  }
  const distribution =
    /(?:^|\n)ID=([^\n]+)/.exec(release)?.[1]?.replaceAll('"', "") ?? "unknown";
  if (!/(?:^|\n)ID=ubuntu(?:\n|$)/.test(release)) {
    throw new ArchiveError("unsupported_distro", distribution);
  }
  const sudo = process.getuid?.() === 0 ? [] : ["sudo"];
  const apt = [...sudo, "apt-get"];
  if (sudo.length > 0) await requirePackageManager(context, "sudo");
  await requireCommand(context, apt[0] as string, [...apt.slice(1), "update"]);
  // Node comes from the pinned bootstrap. JDK 25 runs from the pinned container image.
  const packages = [
    ...(missing.has("docker") ? ["docker.io"] : []),
    ...(missing.has("jdk21") ? ["openjdk-21-jdk"] : []),
    ...(missing.has("ffmpeg") ? ["ffmpeg"] : []),
    ...(missing.has("blender") ? ["blender"] : []),
  ];
  if (packages.length > 0) {
    await requireCommand(context, apt[0] as string, [
      ...apt.slice(1),
      "install",
      ...(yes ? ["-y"] : []),
      ...packages,
    ]);
  }
  if (missing.has("blockbench")) {
    const deb = join(workspace, "Blockbench_5.2.2.deb");
    await downloadVerified(
      context.blockbenchArchive.url,
      context.blockbenchArchive.sha256,
      deb,
      context.fetch,
      context.signal,
      160 * 1024 * 1024,
    );
    await requireCommand(context, apt[0] as string, [
      ...apt.slice(1),
      "install",
      ...(yes ? ["-y"] : []),
      deb,
    ]);
  }
  if (missing.has("docker")) {
    await requireCommand(context, sudo[0] ?? "systemctl", [
      ...(sudo.length > 0 ? ["systemctl"] : []),
      "enable",
      "--now",
      "docker",
    ]);
  }
}

async function installWindows(
  context: Context,
  missing: ReadonlySet<string>,
  yes: boolean,
): Promise<void> {
  await requirePackageManager(context, "winget");
  const packages = [
    ...(missing.has("node") || missing.has("npx")
      ? [["OpenJS.NodeJS", undefined] as const]
      : []),
    ...(missing.has("docker")
      ? [["Docker.DockerDesktop", undefined] as const]
      : []),
    ...(missing.has("jdk21")
      ? [["EclipseAdoptium.Temurin.21.JDK", undefined] as const]
      : []),
    ...(missing.has("jdk25")
      ? [["EclipseAdoptium.Temurin.25.JDK", undefined] as const]
      : []),
    ...(missing.has("blockbench")
      ? [
          [
            BLOCKBENCH_DESKTOP_ARCHIVE.windowsWingetId,
            BLOCKBENCH_DESKTOP_ARCHIVE.version,
          ] as const,
        ]
      : []),
    ...(missing.has("blender")
      ? [["BlenderFoundation.Blender", undefined] as const]
      : []),
    ...(missing.has("ffmpeg") ? [["Gyan.FFmpeg", undefined] as const] : []),
  ];
  for (const [id, version] of packages) {
    await requireCommand(context, "winget", [
      "install",
      "--id",
      id,
      "--exact",
      ...(version === undefined ? [] : ["--version", version]),
      ...(yes
        ? ["--accept-package-agreements", "--accept-source-agreements"]
        : []),
    ]);
  }
}

async function verifyInstalled(installRoot: string): Promise<string> {
  try {
    const manifest = JSON.parse(
      await readFile(join(installRoot, "package.json"), "utf8"),
    ) as {
      name?: string;
      version?: string;
      bin?: Record<string, string>;
    };
    const relative = manifest.bin?.["blockbench-mcp-headless"];
    if (
      manifest.name !== "blockbench-mcp" ||
      manifest.version !== BLOCKBENCH_MCP_VERSION ||
      relative === undefined
    ) {
      throw new Error("manifest");
    }
    const bin = join(installRoot, relative);
    const info = await stat(bin);
    if (!info.isFile()) throw new Error("bin");
    return bin;
  } catch {
    throw new ArchiveError("package_verification_failed");
  }
}

async function installMcp(
  context: Context,
  workspace: string,
): Promise<string> {
  const installRoot = join(
    context.dataHome,
    "tools",
    "blockbench-mcp",
    BLOCKBENCH_MCP_REVISION,
  );
  try {
    return await verifyInstalled(installRoot);
  } catch (error) {
    if ((error as ArchiveError).code !== "package_verification_failed")
      throw error;
    try {
      await stat(installRoot);
      throw new ArchiveError("package_verification_failed");
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== "ENOENT")
        throw statError;
    }
  }

  const archive = join(workspace, "blockbench-mcp.tar.gz");
  await downloadVerified(
    context.archive.url,
    context.archive.sha256,
    archive,
    context.fetch,
    context.signal,
    64 * 1024 * 1024,
  );
  const parent = dirname(installRoot);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(parent, ".install-"));
  try {
    const root = await extractTarGz(
      archive,
      join(staging, "tree"),
      context.signal,
    );
    const project = join(staging, "tree", root);
    const install = await context.runCommand(
      "npx",
      ["--yes", "corepack@0.34.5", "pnpm", "install", "--ignore-scripts"],
      {
        cwd: project,
        env: { ...context.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
        signal: context.signal,
        echo: true,
      },
    );
    if (install.code !== 0)
      throw new ArchiveError("package_install_failed", install.stderr);
    await verifyInstalled(project);
    await rename(project, installRoot);
    return await verifyInstalled(installRoot);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function printConfiguration(
  context: Context,
  bin: string,
  modelRoot: string,
): void {
  const text = messages[context.lang];
  const configuration = {
    mcpServers: {
      "blockbench-headless": {
        command: process.execPath,
        args: [bin, "--root", modelRoot],
      },
    },
  };
  context.stdout.write(
    `${text.ready}\nrisky_eval: disabled\n${text.stdio}\n${JSON.stringify(configuration, null, 2)}\n`,
  );
  context.stdout.write(
    `${text.desktop}\n${text.desktopCommand}\n${DESKTOP_PLUGIN_URL}\n`,
  );
  context.stdout.write(
    "Blockbench desktop MCP: http://127.0.0.1:3000/bb-mcp\n",
  );
}

function localizedError(context: Context, error: unknown): string {
  const text = messages[context.lang];
  if (error instanceof ArchiveError) {
    const inlineDetail =
      error.code === "unsupported_distro" ||
      error.code === "unsupported_platform" ||
      error.code === "package_manager_unavailable";
    const detail = error.message.includes(": ")
      ? `${inlineDetail ? "" : "\n"}${error.message.slice(error.message.indexOf(": ") + 2)}`
      : "";
    const message =
      error.code === "archive_hash_mismatch"
        ? text.hash
        : error.code === "archive_traversal" ||
            error.code === "archive_multiple_roots"
          ? text.traversal
          : error.code === "archive_symlink" ||
              error.code === "archive_hardlink"
            ? text.symlink
            : error.code === "download_failed" ||
                error.code === "archive_too_large"
              ? text.download
              : error.code === "package_install_failed"
                ? text.install
                : error.code === "package_verification_failed"
                  ? text.package
                  : error.code === "unsupported_distro"
                    ? text.unsupportedDistro
                    : error.code === "unsupported_platform"
                      ? text.unsupportedPlatform
                      : error.code === "package_manager_unavailable"
                        ? text.packageManager
                        : text.download;
    return `${text.failed} [${error.code}]: ${message}${detail}`;
  }
  return `${text.failed}: ${error instanceof Error ? error.message : String(error)}`;
}

async function setup(
  context: Context,
  yes: boolean,
  requestedRoot?: string,
): Promise<number> {
  const modelRoot = requestedRoot ?? join(context.home, "models");
  const initial = await doctor(context);
  printDoctor(context, initial);
  const missing = new Set(
    initial.filter((check) => !check.installed).map((check) => check.id),
  );
  if (!yes) {
    const answer =
      context.prompt === undefined
        ? ""
        : await context.prompt(messages[context.lang].confirm);
    if (!/^(?:y|yes|да|д|是|好)$/i.test(answer.trim())) {
      context.stdout.write(`${messages[context.lang].cancelled}\n`);
      return 0;
    }
  }
  await mkdir(modelRoot, { recursive: true, mode: 0o700 });
  await mkdir(context.tempRoot, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(join(context.tempRoot, "voxellume-setup-"));
  try {
    if (missing.size > 0) {
      context.stdout.write(`${messages[context.lang].installing}\n`);
      if (context.platform === "darwin")
        await installMac(context, missing, workspace);
      else if (context.platform === "linux")
        await installUbuntu(context, missing, yes, workspace);
      else if (context.platform === "win32")
        await installWindows(context, missing, yes);
      else throw new ArchiveError("unsupported_platform", context.platform);
    }
    if (missing.size > 0) {
      const remaining = (await doctor(context)).filter(
        (check) => !check.installed,
      );
      if (remaining.length > 0) {
        printDoctor(context, remaining);
        context.stderr.write(`${messages[context.lang].manual}\n`);
        return 1;
      }
    }
    context.stdout.write(`${messages[context.lang].installingMcp}\n`);
    const bin = await installMcp(context, workspace);
    printConfiguration(context, bin, modelRoot);
    return 0;
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rmdir(context.tempRoot).catch(() => undefined);
  }
}

function parseArguments(argv: readonly string[]): {
  command: "doctor" | "setup";
  lang: SetupLanguage;
  yes: boolean;
  root?: string;
} {
  if (argv.length === 0 || (argv[0] !== "doctor" && argv[0] !== "setup"))
    throw new Error("arguments");
  const command = argv[0];
  let lang: SetupLanguage | undefined;
  let yes = false;
  let root: string | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--lang" && lang === undefined) {
      const value = argv[index + 1];
      if (value !== "en" && value !== "ru" && value !== "zh-CN")
        throw new Error("language");
      lang = value;
      index += 1;
    } else if (argument === "--yes" && command === "setup" && !yes) {
      yes = true;
    } else if (
      argument === "--blockbench-mcp-root" &&
      command === "setup" &&
      root === undefined
    ) {
      const value = argv[index + 1];
      if (value === undefined || !isAbsolute(value)) throw new Error("root");
      root = value;
      index += 1;
    } else {
      throw new Error("arguments");
    }
  }
  if (lang === undefined) throw new Error("language");
  return { command, lang, yes, ...(root === undefined ? {} : { root }) };
}

export async function runSetupCli(
  argv: readonly string[],
  dependencies: SetupCliDependencies = {},
  signal = new AbortController().signal,
): Promise<number> {
  let parsed: ReturnType<typeof parseArguments>;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    const lang =
      argv.includes("--lang") && argv.includes("ru")
        ? "ru"
        : argv.includes("zh-CN")
          ? "zh-CN"
          : "en";
    const text = messages[lang];
    const detail =
      (error as Error).message === "root"
        ? text.root
        : (error as Error).message === "language"
          ? text.declined
          : text.invalid;
    (dependencies.stderr ?? process.stderr).write(`${detail}\n${text.usage}\n`);
    return 2;
  }
  const context = makeContext(parsed.lang, dependencies, signal);
  try {
    if (parsed.command === "doctor") {
      const checks = await doctor(context);
      printDoctor(context, checks);
      return checks.every((check) => check.installed) ? 0 : 1;
    }
    return await setup(context, parsed.yes, parsed.root);
  } catch (error) {
    if (signal.aborted || (error as Error).name === "AbortError") {
      context.stderr.write(`${messages[context.lang].cancelled}\n`);
      return 130;
    }
    context.stderr.write(`${localizedError(context, error)}\n`);
    return 1;
  }
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const prompt = async (question: string): Promise<string> => {
    const reader = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return await reader.question(question);
    } finally {
      reader.close();
    }
  };
  try {
    process.exitCode = await runSetupCli(
      process.argv.slice(2),
      { prompt },
      controller.signal,
    );
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
