import { tool } from "@opencode-ai/plugin";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
const PLUGIN_NAME = "opencode-durable-task-state";
const STATE_DIRECTORY = path.join(".agent", "sessions");
function stateRelativePath(sessionID) {
    const segment = /^[A-Za-z0-9_-]+$/.test(sessionID) ? sessionID : `encoded-${encodeURIComponent(sessionID)}`;
    return path.join(STATE_DIRECTORY, segment, "task.md");
}
function projectRoot(worktree, directory) {
    const resolved = path.resolve(worktree);
    return resolved === path.parse(resolved).root ? path.resolve(directory) : resolved;
}
const server = (async ({ directory, worktree }) => {
    // The supervised launcher has its own state contract and compaction plugin.
    if (process.env.OPENCODE_SUPERVISED === "1")
        return {};
    const root = projectRoot(worktree, directory);
    return {
        tool: {
            task_state: tool({
                description: "Read, replace, or delete this OpenCode session's own durable task snapshot. The state path is derived from the calling session ID and cannot be selected by the caller.",
                args: {
                    operation: tool.schema.enum(["read", "write", "delete"]),
                    content: tool.schema
                        .string()
                        .optional()
                        .describe("Complete snapshot content. Required for write; omit for read or delete."),
                },
                async execute({ operation, content }, context) {
                    const statePath = stateRelativePath(context.sessionID);
                    const stateFile = path.join(projectRoot(context.worktree, context.directory), statePath);
                    if (operation === "read") {
                        const state = await readFile(stateFile, "utf8").catch(() => "");
                        return state.trim() || "No durable task state exists for this session.";
                    }
                    if (operation === "delete") {
                        await rm(stateFile, { force: true });
                        return `Deleted ${statePath}`;
                    }
                    const state = content?.trim();
                    if (!state)
                        throw new Error("content is required when operation is write");
                    await mkdir(path.dirname(stateFile), { recursive: true });
                    await writeFile(stateFile, `${state}\n`, "utf8");
                    return `Updated ${statePath}`;
                },
            }),
        },
        "experimental.chat.system.transform": async ({ sessionID }, output) => {
            if (!sessionID)
                return;
            const statePath = stateRelativePath(sessionID);
            output.system.push(`## Session-scoped durable task state

This OpenCode session's durable state path is \`${statePath}\`. For substantial work, use the \`task_state\` tool to read, replace, or delete only this session's concise recovery snapshot. Never access task-state files with general filesystem or shell tools, and never read, write, or reuse another session's snapshot. Do not create state for quick answers or trivial edits.`);
        },
        "experimental.session.compacting": async ({ sessionID }, output) => {
            const statePath = stateRelativePath(sessionID);
            const stateFile = path.join(root, statePath);
            const state = await readFile(stateFile, "utf8").catch(() => "");
            if (!state.trim())
                return;
            output.context.push(`## Durable task state

The ordinary workflow's durable task snapshot for this exact OpenCode session from \`${statePath}\` follows. Preserve its assigned work, approved plan, explicit decisions, scope, status, blockers, progress, relevant paths, and next action. It is this session's authoritative recovery snapshot, not a transcript or a substitute for canonical project documentation.

After compaction, the continuing session must reread its snapshot through \`task_state\` before consequential work and reconcile it with any newer instructions in this session. Newer instructions override conflicting snapshot content. Do not use another session's snapshot in its place.

--- BEGIN ${statePath} ---
${state.trim()}
--- END ${statePath} ---`);
        },
    };
});
export default {
    id: PLUGIN_NAME,
    server,
};
