import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const opencode = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "opencode.cmd" : "opencode")

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk))
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk))
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

const temp = await mkdtemp(path.join(os.tmpdir(), "opencode-durable-task-state-"))

try {
  const packed = await run(npm, ["pack", "--json", "--ignore-scripts", "--pack-destination", temp])
  assert.equal(packed.code, 0, packed.stderr || packed.stdout)
  const [{ filename, files }] = JSON.parse(packed.stdout)
  const names = files.map((file) => file.path).sort()
  assert.deepEqual(names, [
    "LICENSE",
    "README.md",
    "dist/durable-task-state.js",
    "package.json",
  ])

  const fixture = path.join(temp, "fixture")
  await mkdir(fixture)
  await writeFile(path.join(fixture, "package.json"), '{"private":true,"type":"module"}\n')
  const installed = await run(
    npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", path.join(temp, filename)],
    { cwd: fixture },
  )
  assert.equal(installed.code, 0, installed.stderr || installed.stdout)

  await writeFile(
    path.join(fixture, "verify.mjs"),
    [
      'import plugin from "opencode-durable-task-state/server"',
      'if (plugin.id !== "opencode-durable-task-state") throw new Error("Unexpected plugin id")',
      "const hooks = await plugin.server({ directory: process.cwd(), worktree: process.cwd() })",
      'if (typeof hooks.tool?.task_state?.execute !== "function") throw new Error("Missing task_state tool")',
      'if (typeof hooks["experimental.session.compacting"] !== "function") throw new Error("Missing hook")',
      "",
    ].join("\n"),
  )
  const imported = await run(process.execPath, ["verify.mjs"], { cwd: fixture })
  assert.equal(imported.code, 0, imported.stderr || imported.stdout)

  const version = await run(opencode, ["--version"])
  assert.equal(version.code, 0, version.stderr || version.stdout)
  assert.equal(version.stdout.trim(), "1.18.35")

  const configDir = path.join(temp, "config", "opencode")
  await mkdir(configDir, { recursive: true })
  const packageDir = path.join(fixture, "node_modules", "opencode-durable-task-state")
  await writeFile(
    path.join(configDir, "opencode.json"),
    `${JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        plugin: [pathToFileURL(packageDir).href],
      },
      null,
      2,
    )}\n`,
  )

  const smoke = await run(opencode, ["debug", "agent", "build"], {
    cwd: fixture,
    env: {
      ...process.env,
      HOME: path.join(temp, "home"),
      XDG_CACHE_HOME: path.join(temp, "cache"),
      XDG_CONFIG_HOME: path.join(temp, "config"),
      XDG_DATA_HOME: path.join(temp, "data"),
      XDG_STATE_HOME: path.join(temp, "state"),
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    },
  })
  assert.equal(smoke.code, 0, smoke.stderr || smoke.stdout)
  assert.match(smoke.stdout, /"task_state"/, "OpenCode 1.18.35 did not register the packed plugin's task_state tool")
} finally {
  await rm(temp, { recursive: true, force: true })
}
