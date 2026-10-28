#!/usr/bin/env bun
/**
 * 路由冒烟测试：用 agent-browser CLI 驱动真实浏览器，覆盖首页重定向、单场深链刷新、
 * 无效 id 兜底、对比 ?ids= 深链、前进后退五个场景。
 *
 * 只依赖 Node 内置模块；不负责起停服务器，可对 dev / preview / CI 任意 base URL 运行：
 *   bun scripts/smoke-routes.mjs --url http://localhost:5173
 *   BASE_URL=http://localhost:4173 bun scripts/smoke-routes.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(appRoot, "public");
const DEFAULT_URL = "http://localhost:5173";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let url = process.env.BASE_URL ?? DEFAULT_URL;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") {
      const next = argv[i + 1];
      if (!next) fail("--url 需要一个地址");
      url = next;
      i += 1;
    } else if (arg.startsWith("--url=")) {
      url = arg.slice("--url=".length);
    } else if (arg === "--help" || arg === "-h") {
      console.log("用法: bun scripts/smoke-routes.mjs [--url http://localhost:5173]");
      process.exit(0);
    }
  }
  return { baseUrl: url.replace(/\/+$/, "") };
}

const { baseUrl } = parseArgs(process.argv.slice(2));

function loadFixture() {
  const index = readJson(join(publicRoot, "data", "index.json"));
  const firstDataset = index.datasets?.[0];
  if (!firstDataset?.id) fail("public/data/index.json 里没有 datasets");

  const manifestPath = firstDataset.manifest
    ? join(publicRoot, firstDataset.manifest)
    : join(publicRoot, "data", firstDataset.id, "manifest.json");
  if (!existsSync(manifestPath)) {
    fail(`找不到 manifest：${manifestPath}（先运行 bun run sync:data）`);
  }

  const streams = readJson(manifestPath).streams ?? [];
  if (streams.length === 0) fail(`manifest 里没有 streams：${manifestPath}`);

  return {
    datasetId: firstDataset.id,
    videoId: streams[0].videoId,
    streamTitle: streams[0].title ?? "",
    compareIds: streams.slice(0, 2).map(stream => stream.videoId),
  };
}

const { datasetId, videoId, streamTitle, compareIds } = loadFixture();

const streamUrl = `${baseUrl}/#/${datasetId}/stream/${videoId}`;
const invalidUrl = `${baseUrl}/#/${datasetId}/stream/not-a-real-id`;
const compareUrl = `${baseUrl}/#/${datasetId}/compare?ids=${compareIds.join(",")}`;
const overviewHash = `#/${datasetId}/overview`;
const STREAM_STAT_LABEL = "平均 / 最大同接";
const NOT_FOUND_TEXT = "找不到这场直播";
const COMPARE_TITLE = "指标对比";

/**
 * Windows 上 npm 的全局包装是 .cmd，Bun 无法把含双引号的参数安全传进去，
 * 稳妥起见直接定位真正的 JS 入口并用 node.exe 运行（Unix 上直接用 agent-browser）。
 */
function resolveCli() {
  if (process.platform !== "win32") return { command: "agent-browser", prefix: [] };
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    if (!existsSync(join(dir, "agent-browser.cmd"))) continue;
    const bin = join(dir, "node_modules", "agent-browser", "bin", "agent-browser.js");
    const nodeExe = join(dir, "node.exe");
    if (existsSync(bin) && existsSync(nodeExe)) return { command: nodeExe, prefix: [bin] };
  }
  return { command: "agent-browser", prefix: [] };
}

const CLI = resolveCli();
const session = `smoke-${process.pid}`;

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

function cliArgs(args) {
  return [...CLI.prefix, "--session", session, ...args];
}

function execCli(args, timeout) {
  return execFileSync(CLI.command, cliArgs(args), {
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

function ab(args, timeout = 90_000) {
  try {
    return execCli(args, timeout);
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    const status = error.status ?? error.signal ?? error.code;
    throw new Error(`agent-browser ${args.join(" ")} 失败（${status}）：${stderr || stdout || error.message}`);
  }
}

function warmup() {
  // 首次 open 会拉起浏览器守护进程，它继承子进程的 stderr 管道导致 execFileSync 挂住，
  // 因此先用 stdio:ignore 无输出地预热一次；之后每条命令都能正常拿到输出。
  const result = spawnSync(CLI.command, cliArgs(["open"]), { stdio: "ignore", timeout: 120_000 });
  if (result.error && result.error.code === "ENOENT") throw result.error;
}

function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const page = {
  open: url => ab(["open", url]),
  reload: () => ab(["reload"]),
  back: () => ab(["back"]),
  forward: () => ab(["forward"]),
  url: () => ab(["get", "url"]),
  waitLoad: () => ab(["wait", "--load", "networkidle"]),
  waitText: text => ab(["wait", "--text", text]),
  text: (selector = "body") => ab(["get", "text", selector]),
  clickLink: name => ab(["find", "role", "link", "click", "--name", name]),
  eval: js => parseValue(ab(["eval", js])),
  close: () => ab(["close"], 30_000),
};

async function hash() {
  return String((await page.eval("location.hash")) ?? "");
}

async function bodyText() {
  return page.text("body");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(label, check, timeout = 20_000, interval = 250) {
  const startedAt = Date.now();
  let lastError = "";
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() - startedAt > timeout) {
      throw new Error(`${label} 超时（${timeout}ms）${lastError ? `：${lastError}` : ""}`);
    }
    await sleep(interval);
  }
}

function probe(url, timeout = 5000) {
  return new Promise(resolveProbe => {
    const client = url.startsWith("https:") ? httpsGet : httpGet;
    const req = client(url, res => {
      res.resume();
      resolveProbe({ ok: true, status: res.statusCode ?? 0 });
    });
    req.on("error", error => resolveProbe({ ok: false, error }));
    req.setTimeout(timeout, () => {
      req.destroy(new Error(`请求超时（${timeout}ms）`));
    });
  });
}

const scenarios = [
  {
    name: "首页重定向 / → overview",
    async run() {
      await page.open(`${baseUrl}/`);
      await page.waitLoad();
      await waitFor("等待重定向到 overview", async () => {
        const value = await hash();
        return value === overviewHash ? value : null;
      });
      const current = await hash();
      assert(current === overviewHash, `期望 ${overviewHash}，实际 ${current || "(空)"}`);
      const fullUrl = await page.url();
      assert(fullUrl.includes(overviewHash), `地址栏没有落地到 ${overviewHash}：${fullUrl}`);
    },
  },
  {
    name: `单场深链刷新 ${streamUrl.replace(baseUrl, "")}`,
    async run() {
      await page.open(streamUrl);
      await page.waitLoad();
      await page.waitText(STREAM_STAT_LABEL);

      const before = await hash();
      assert(before.includes(videoId), `hash 里没有 ${videoId}：${before}`);

      const text = await bodyText();
      const rendered = text.includes(STREAM_STAT_LABEL) || (streamTitle !== "" && text.includes(streamTitle));
      assert(rendered, "单场页面既没有「平均 / 最大同接」也没有标题文本");

      await page.reload();
      await page.waitLoad();
      await page.waitText(STREAM_STAT_LABEL);

      const after = await hash();
      assert(after === before, `刷新后 hash 变了：${before} → ${after}`);
      const reloadedText = await bodyText();
      const stillRendered =
        reloadedText.includes(STREAM_STAT_LABEL) || (streamTitle !== "" && reloadedText.includes(streamTitle));
      assert(stillRendered, "刷新后单场内容消失");
    },
  },
  {
    name: `无效 id ${invalidUrl.replace(baseUrl, "")}`,
    async run() {
      await page.open(invalidUrl);
      await page.waitLoad();
      await page.waitText(NOT_FOUND_TEXT);
      const text = await bodyText();
      assert(text.includes(NOT_FOUND_TEXT), `页面缺少「${NOT_FOUND_TEXT}」`);
      assert(text.includes("not-a-real-id"), "兜底页面没有回显无效 id");
    },
  },
  {
    name: `对比深链 ids=${compareIds.join(",")}`,
    async run() {
      await page.open(compareUrl);
      await page.waitLoad();
      await page.waitText(COMPARE_TITLE);

      const route = String((await page.eval("new URL(location.href).hash")) ?? "");
      const decoded = decodeURIComponent(route);
      assert(decoded.includes("ids="), `URL 里没有 ids 参数：${route}`);
      for (const id of compareIds) {
        assert(decoded.includes(id), `URL 里没有 id ${id}：${route}`);
      }

      const text = await bodyText();
      assert(text.includes(COMPARE_TITLE), `对比页面缺少「${COMPARE_TITLE}」`);
    },
  },
  {
    name: "前进后退 单场 → 数据表 → back → forward",
    async run() {
      await page.open(streamUrl);
      await page.waitLoad();
      await page.waitText(STREAM_STAT_LABEL);
      const streamHash = await hash();

      await page.clickLink("数据表");
      await waitFor("等待进入数据表", async () => {
        const value = await hash();
        return value.endsWith("/table") ? value : null;
      });

      await page.back();
      await waitFor("等待 back 回到单场", async () => {
        const value = await hash();
        return value === streamHash ? value : null;
      });

      await page.forward();
      await waitFor("等待 forward 回到数据表", async () => {
        const value = await hash();
        return value.endsWith("/table") ? value : null;
      });
    },
  },
];

let closed = false;

try {
  try {
    execCli(["--version"], 30_000);
  } catch (error) {
    fail(
      `未找到可用的 agent-browser（${error instanceof Error ? error.message : String(error)}）。\n` +
        "  安装：npm install -g agent-browser && agent-browser install\n" +
        "  提示：请用 Bun 运行本脚本（bun scripts/smoke-routes.mjs）。",
    );
  }

  const health = await probe(baseUrl);
  if (!health.ok) {
    const reason = health.error?.message || health.error?.code || "未知错误";
    console.error(`✗ 无法访问 ${baseUrl}：${reason}`);
    console.error(
      "  本脚本不会自行起停服务器，请先启动一个（数据已在 public/data 里生成）：\n" +
        "    bunx vite --port 5173 --strictPort\n" +
        "    bunx vite preview --port 4173 --strictPort\n" +
        "  再用 --url 或 BASE_URL 指向它。",
    );
    process.exit(1);
  }

  console.log(`smoke ${baseUrl} · dataset=${datasetId} · stream=${videoId} · session=${session}`);

  try {
    warmup();
  } catch (error) {
    fail(`无法启动浏览器：${error instanceof Error ? error.message : String(error)}`);
  }

  let failed = 0;
  for (const scenario of scenarios) {
    try {
      await scenario.run();
      console.log(`✓ ${scenario.name}`);
    } catch (error) {
      failed += 1;
      console.error(`✗ ${scenario.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed}/${scenarios.length} 个场景失败`);
    process.exitCode = 1;
  } else {
    console.log(`\n${scenarios.length}/${scenarios.length} 个场景通过`);
  }
} finally {
  if (!closed) {
    closed = true;
    try {
      page.close();
    } catch {
      /* 浏览器可能从未成功启动 */
    }
  }
}
