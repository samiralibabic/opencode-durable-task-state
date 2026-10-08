import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import DurableTaskStateModule from "../dist/durable-task-state.js"

async function withProject(callback) {
  const project = await mkdtemp(path.join(os.tmpdir(), "opencode-durable-task-state-"))
  try {
    return await callback(project)
  } finally {
    await rm(project, { recursive: true, force: true })
  }
}

async function hooks(project) {
  return DurableTaskStateModule.server({ directory: project, worktree: project })
}

function context(project, sessionID, overrides = {}) {
  return { sessionID, directory: project, worktree: project, ...overrides }
}

async function taskState(plugin, args, ctx) {
  return plugin.tool.task_state.execute(args, ctx)
}

async function compacting(plugin, sessionID) {
  const output = { context: [] }
  await plugin["experimental.session.compacting"]({ sessionID }, output)
  return output.context
}

test("exports a named OpenCode server plugin module", () => {
  assert.equal(DurableTaskStateModule.id, "opencode-durable-task-state")
  assert.equal(typeof DurableTaskStateModule.server, "function")
})

test("writes, reads, and deletes only the calling session's snapshot", async () => {
  await withProject(async (project) => {
    const plugin = await hooks(project)
    const ctx = context(project, "ses_abc-123")

    assert.equal(await taskState(plugin, { operation: "read" }, ctx), "No durable task state exists for this session.")

    const statePath = path.join(".agent", "sessions", "ses_abc-123", "task.md")
    assert.equal(await taskState(plugin, { operation: "write", content: "  # State\n\nWorking  \n" }, ctx), `Updated ${statePath}`)
    assert.equal(await readFile(path.join(project, statePath), "utf8"), "# State\n\nWorking\n")
    assert.equal(await taskState(plugin, { operation: "read" }, ctx), "# State\n\nWorking")

    const other = context(project, "ses_other")
    assert.equal(await taskState(plugin, { operation: "read" }, other), "No durable task state exists for this session.")

    assert.equal(await taskState(plugin, { operation: "delete" }, ctx), `Deleted ${statePath}`)
    await assert.rejects(stat(path.join(project, statePath)))
    assert.equal(await taskState(plugin, { operation: "delete" }, ctx), `Deleted ${statePath}`)
  })
})

test("requires non-empty content for writes", async () => {
  await withProject(async (project) => {
    const plugin = await hooks(project)
    const ctx = context(project, "ses_write")

    await assert.rejects(taskState(plugin, { operation: "write" }, ctx), /content is required/)
    await assert.rejects(taskState(plugin, { operation: "write", content: " \n " }, ctx), /content is required/)
  })
})

test("encodes session IDs that are not safe path segments", async () => {
  await withProject(async (project) => {
    const plugin = await hooks(project)
    const ctx = context(project, "../escape/id")

    const result = await taskState(plugin, { operation: "write", content: "state" }, ctx)
    const expected = path.join(".agent", "sessions", "encoded-..%2Fescape%2Fid", "task.md")
    assert.equal(result, `Updated ${expected}`)
    assert.equal(await readFile(path.join(project, expected), "utf8"), "state\n")
  })
})

test("uses the directory when the worktree is the filesystem root", async () => {
  await withProject(async (project) => {
    const root = path.parse(project).root
    const plugin = await DurableTaskStateModule.server({ directory: project, worktree: root })
    const ctx = context(project, "ses_rootless", { worktree: root })

    await taskState(plugin, { operation: "write", content: "rootless" }, ctx)
    const file = path.join(project, ".agent", "sessions", "ses_rootless", "task.md")
    assert.equal(await readFile(file, "utf8"), "rootless\n")
    assert.match((await compacting(plugin, "ses_rootless"))[0], /rootless/)
  })
})

test("adds the exact state path to system context", async () => {
  await withProject(async (project) => {
    const plugin = await hooks(project)
    const output = { system: [] }

    await plugin["experimental.chat.system.transform"]({ sessionID: "ses_system" }, output)
    assert.equal(output.system.length, 1)
    assert.match(output.system[0], /^## Session-scoped durable task state/)
    assert.ok(output.system[0].includes(`\`${path.join(".agent", "sessions", "ses_system", "task.md")}\``))

    const missing = { system: [] }
    await plugin["experimental.chat.system.transform"]({}, missing)
    assert.deepEqual(missing.system, [])
  })
})

test("injects only the compacting session's existing snapshot", async () => {
  await withProject(async (project) => {
    const plugin = await hooks(project)
    const sessions = path.join(project, ".agent", "sessions")
    await mkdir(path.join(sessions, "ses_one"), { recursive: true })
    await mkdir(path.join(sessions, "ses_two"), { recursive: true })
    await writeFile(path.join(sessions, "ses_one", "task.md"), "\nOne state\n")
    await writeFile(path.join(sessions, "ses_two", "task.md"), "Two state\n")

    const injected = await compacting(plugin, "ses_one")
    assert.equal(injected.length, 1)
    assert.match(injected[0], /^## Durable task state/)
    assert.ok(injected[0].includes("One state"))
    assert.ok(!injected[0].includes("Two state"))
    const statePath = path.join(".agent", "sessions", "ses_one", "task.md")
    assert.ok(injected[0].includes(`--- BEGIN ${statePath} ---\nOne state\n--- END ${statePath} ---`))

    assert.deepEqual(await compacting(plugin, "ses_missing"), [])

    await writeFile(path.join(sessions, "ses_two", "task.md"), "  \n")
    assert.deepEqual(await compacting(plugin, "ses_two"), [])
  })
})

test("stays inactive for supervised launches", async () => {
  const original = process.env.OPENCODE_SUPERVISED
  process.env.OPENCODE_SUPERVISED = "1"
  try {
    assert.deepEqual(await DurableTaskStateModule.server({ directory: os.tmpdir(), worktree: os.tmpdir() }), {})
  } finally {
    if (original === undefined) delete process.env.OPENCODE_SUPERVISED
    else process.env.OPENCODE_SUPERVISED = original
  }
})
