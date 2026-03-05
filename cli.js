#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { execSync } = require("child_process");

const SERVER_NAME_DEFAULT = "tiger_den";
const MCP_REMOTE_PKG = "mcp-remote";
const MCP_URL_DEFAULT = "https://tiger-den.vercel.app/api/mcp/mcp";

// Current Claude Desktop config filename
const CONFIG_FILENAME = "claude_desktop_config.json";
// Optional legacy filename (older docs / installs)
const LEGACY_FILENAME = "settings.json";

// Version: prefer package.json version if available, else fallback
const FALLBACK_VERSION = "0.1.0";
function getVersion() {
  try {
    const pkgPath = path.join(__dirname, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg && pkg.version) return String(pkg.version);
  } catch {
    // ignore
  }
  return FALLBACK_VERSION;
}

function banner() {
  const lines = [
    "┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓",
    "┃          Tiger Den MCP Setup for Claude       ┃",
    "┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛",
  ];
  console.log("\n" + lines.join("\n"));
}

function logStep(n, msg) {
  console.log(`\n▶ Step ${n}: ${msg}`);
}
function logInfo(msg) {
  console.log(`   ${msg}`);
}
function logOk(msg) {
  console.log(`✅ ${msg}`);
}
function logWarn(msg) {
  console.log(`⚠️  ${msg}`);
}
function logErr(msg) {
  console.error(`❌ ${msg}`);
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function defaultConfigPath() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", CONFIG_FILENAME);
  }
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA;
    if (!appdata) throw new Error("APPDATA is not set; cannot locate Claude Desktop config on Windows.");
    return path.join(appdata, "Claude", CONFIG_FILENAME);
  }
  return path.join(os.homedir(), ".config", "Claude", CONFIG_FILENAME);
}

function legacyConfigPath() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", LEGACY_FILENAME);
  }
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA || "";
    return path.join(appdata, "Claude", LEGACY_FILENAME);
  }
  return path.join(os.homedir(), ".config", "Claude", LEGACY_FILENAME);
}

/**
 * Prefer current config filename, but fall back to legacy filename if it exists.
 * If neither exists, return the current default path (so we create it there).
 */
function resolveDefaultConfigPathWithFallback() {
  const primary = defaultConfigPath();
  if (fs.existsSync(primary)) return primary;

  const legacy = legacyConfigPath();
  if (legacy && fs.existsSync(legacy)) return legacy;

  return primary;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Invalid JSON in Claude Desktop config file:\n${filePath}\n\nFix the JSON and re-run.\n\nOriginal error: ${e.message}`
    );
  }
}

function backup(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const bakPath = `${filePath}.bak-${stamp()}`;
  fs.copyFileSync(filePath, bakPath);
  return bakPath;
}

function deepMerge(a, b) {
  if (typeof a !== "object" || a === null) return b;
  if (typeof b !== "object" || b === null) return b;
  if (Array.isArray(a) || Array.isArray(b)) return b;

  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out;
}

// Stable stringify (sorted keys) to avoid false diffs due to key order
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const keys = Object.keys(value).sort();
  const props = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${props.join(",")}}`;
}

function parseArgs(argv) {
  const args = {
    config: null,
    name: SERVER_NAME_DEFAULT,
    url: MCP_URL_DEFAULT,
    token: null,
    force: false,
    yes: false, // non-interactive
    doctor: false,
    quiet: false,
    version: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") args.config = argv[++i];
    else if (a === "--name") args.name = argv[++i];
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--token") args.token = argv[++i];
    else if (a === "--force") args.force = true;
    else if (a === "-y" || a === "--yes") args.yes = true;
    else if (a === "--doctor") args.doctor = true;
    else if (a === "--quiet") args.quiet = true;
    else if (a === "--version" || a === "-V") args.version = true;
    else if (a === "-h" || a === "--help") {
      console.log(`
Usage:
  npx -y @mattstratton/tiger-den-mcp-setup [options]

Options:
  --token <td_...>     Tiger Den API key (optional; prompts if omitted)
  --url <https://...>  MCP endpoint (default: ${MCP_URL_DEFAULT})
  --name <tiger_den>   MCP server name in Claude (default: ${SERVER_NAME_DEFAULT})
  --config <path>      Path to Claude Desktop config file (optional)
  --force              Overwrite existing entry if it differs
  -y, --yes            Non-interactive; if no --token and config not found, uses defaults with placeholder token
  --doctor             Check prerequisites and show what will be changed, without writing
  --quiet              Less output (still shows errors/warnings)
  --version, -V        Print version and exit

Notes:
  Default config filename: ${CONFIG_FILENAME}
  Legacy fallback (if it exists): ${LEGACY_FILENAME}
`);
      process.exit(0);
    }
  }
  return args;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve((ans || "").trim());
    })
  );
}

function tokenWarning(token) {
  if (!token) return null;
  if (!token.startsWith("td_")) {
    return `Token does not start with "td_". That might be fine, but double-check you pasted the right value.`;
  }
  return null;
}

function extractBearerTokenFromEntry(entry) {
  // Looks for: "Authorization: Bearer <token>" within args strings
  if (!entry || typeof entry !== "object") return null;
  if (!Array.isArray(entry.args)) return null;

  for (const a of entry.args) {
    if (typeof a !== "string") continue;
    const prefix = "Authorization: Bearer ";
    if (a.startsWith(prefix)) {
      const token = a.slice(prefix.length).trim();
      return token || null;
    }
  }
  return null;
}

async function configPathMenu(primaryPath, legacyPathMaybe) {
  console.log(`Claude Desktop config file was not found at the default location:\n  ${primaryPath}\n`);

  if (legacyPathMaybe) {
    console.log(`(Also checked legacy filename, not found):\n  ${legacyPathMaybe}\n`);
  }

  console.log(`Choose an option:`);
  console.log(`  1) Create ${CONFIG_FILENAME} at the default path`);
  console.log(`  2) Enter a custom path to an existing config file`);
  console.log(`  3) Exit (I'll print help to find it)`);

  const choice = await ask("Enter 1, 2, or 3: ");

  if (choice === "1" || choice === "") return { action: "useDefault", value: primaryPath };
  if (choice === "2") return { action: "custom", value: null };
  if (choice === "3") return { action: "exit", value: null };
  return { action: "invalid", value: null };
}

function printFindHelp(primaryPath) {
  console.log(`\nHow to find Claude Desktop config (${CONFIG_FILENAME}):\n`);

  if (process.platform === "darwin") {
    console.log(`macOS:`);
    console.log(`  Default location is usually:`);
    console.log(`    ${primaryPath}`);
    console.log(`  In Finder: Go → Go to Folder… and paste:`);
    console.log(`    ~/Library/Application Support/Claude/\n`);
  } else if (process.platform === "win32") {
    console.log(`Windows:`);
    console.log(`  Default location is usually:`);
    console.log(`    ${primaryPath}`);
    console.log(`  In Explorer: paste this into the address bar:`);
    console.log(`    %APPDATA%\\Claude\\\n`);
  } else {
    console.log(`Linux:`);
    console.log(`  Default location is usually:`);
    console.log(`    ${primaryPath}\n`);
  }

  console.log(`You can re-run this installer with:`);
  console.log(`  --config "<full path to ${CONFIG_FILENAME}>"\n`);
}

async function resolveConfigPath(args) {
  if (args.config) return args.config;

  const primary = defaultConfigPath();
  const legacy = legacyConfigPath();

  const detected = resolveDefaultConfigPathWithFallback();
  if (fs.existsSync(detected)) return detected;

  if (args.yes) return primary;

  while (true) {
    const sel = await configPathMenu(primary, legacy);

    if (sel.action === "useDefault") return primary;

    if (sel.action === "custom") {
      const custom = await ask("Paste the full path to the Claude Desktop config file: ");
      if (!custom) {
        console.log("No path provided. Returning to menu.\n");
        continue;
      }
      return custom;
    }

    if (sel.action === "exit") {
      printFindHelp(primary);
      process.exit(0);
    }

    console.log("Invalid choice. Please try again.\n");
  }
}

function buildServerEntry({ url, token }) {
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const header = `Authorization: Bearer ${token || "td_your_key_here"}`;
  return {
    command: cmd,
    args: ["-y", MCP_REMOTE_PKG, url, "--header", header],
  };
}

function openFolderHint(configPath) {
  const dir = path.dirname(configPath);
  if (process.platform === "darwin") return `open "${dir}"`;
  if (process.platform === "win32") return `explorer "${dir}"`;
  return dir;
}

function isClaudeRunning() {
  try {
    if (process.platform === "darwin") {
      const out = execSync("ps -ax | grep -i claude | grep -v grep", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
      return out.length > 0;
    }

    if (process.platform === "win32") {
      const out = execSync("tasklist", { stdio: ["ignore", "pipe", "ignore"] }).toString().toLowerCase();
      return out.includes("claude");
    }

    if (process.platform === "linux") {
      const out = execSync("ps -ax", { stdio: ["ignore", "pipe", "ignore"] }).toString().toLowerCase();
      return out.includes("claude");
    }
  } catch {
    return false;
  }
  return false;
}

function checkNode() {
  const okNode = !!process.version;
  return { okNode, nodeVersion: process.version, note: "If npx fails, ensure Node.js is installed and on PATH." };
}

async function doctorReport(args) {
  const primary = defaultConfigPath();
  const legacy = legacyConfigPath();
  const configPath = args.config || resolveDefaultConfigPathWithFallback();

  const env = checkNode();
  const running = isClaudeRunning();

  const current = readJson(configPath);
  const existingEntry = current?.mcpServers?.[args.name];
  const existingToken = extractBearerTokenFromEntry(existingEntry);

  // Determine token used for planned entry in doctor mode:
  //  - args.token wins
  //  - else if existing token exists, we'd reuse it by default
  //  - else placeholder
  const plannedToken = args.token || existingToken || null;
  const entry = buildServerEntry({ url: args.url, token: plannedToken });

  console.log("\n🩺 Doctor report\n");

  console.log("Environment:");
  console.log(`  OS: ${process.platform}`);
  console.log(`  Node: ${env.okNode ? "OK" : "Missing"} (${env.nodeVersion || "unknown"})`);
  console.log(`  Note: ${env.note}`);

  console.log("\nConfig paths checked:");
  console.log(`  Primary: ${primary} ${fs.existsSync(primary) ? "(exists)" : "(not found)"}`);
  console.log(`  Legacy : ${legacy} ${fs.existsSync(legacy) ? "(exists)" : "(not found)"}`);

  console.log("\nTarget config file:");
  console.log(`  ${configPath}`);
  console.log(`  Exists: ${fs.existsSync(configPath) ? "Yes" : "No (will be created at primary unless you use --config)"}`);

  console.log("\nExisting server entry:");
  console.log(`  Present: ${existingEntry ? "Yes" : "No"}`);
  console.log(`  Token found: ${existingToken ? "Yes (will reuse by default)" : "No"}`);

  console.log("\nPlanned MCP server entry:");
  console.log(`  Name: ${args.name}`);
  console.log(`  Command: ${entry.command}`);
  console.log(`  Args: ${JSON.stringify(entry.args)}`);

  console.log(`\nClaude Desktop running: ${running ? "Yes" : "No"}`);

  console.log(`\nTip: open the config folder with:\n  ${openFolderHint(configPath)}\n`);
}

async function resolveTokenWithReuse(args, existingToken) {
  // If --token provided, always use it.
  if (args.token) return args.token.trim();

  // Non-interactive: reuse existing token if present; otherwise placeholder
  if (args.yes) return existingToken || null;

  // Interactive prompt:
  if (existingToken) {
    const t = await ask("Tiger Den API key: Press Enter to reuse existing token, or paste a new one: ");
    return t ? t : existingToken;
  }

  const t = await ask("Tiger Den API key (starts with td_). Press Enter to use placeholder: ");
  return t || null;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.version) {
    console.log(`tiger-den-mcp-setup v${getVersion()}`);
    return;
  }

  if (!args.quiet) banner();

  if (args.doctor) {
    if (!args.quiet) logStep(1, "Check prerequisites (doctor mode)");
    await doctorReport(args);
    console.log("Doctor mode does not write changes. Re-run without --doctor to apply.\n");
    return;
  }

  if (!args.quiet) logStep(1, "Locate Claude Desktop config file");
  const configPath = await resolveConfigPath(args);
  if (!args.quiet) logInfo(`Using: ${configPath}`);

  ensureParentDir(configPath);

  const current = readJson(configPath);
  const existingEntry = current?.mcpServers?.[args.name];
  const existingToken = extractBearerTokenFromEntry(existingEntry);

  if (!args.quiet) logStep(2, "Get your Tiger Den API key");
  const token = await resolveTokenWithReuse(args, existingToken);
  const tokenMsg = tokenWarning(token);
  if (tokenMsg) logWarn(tokenMsg);

  if (!args.quiet) logStep(3, "Prepare MCP configuration");
  const entry = buildServerEntry({ url: args.url, token });

  // Compare existing entry vs desired entry (stable) to avoid false diffs due to key order
  if (existingEntry && stableStringify(existingEntry) !== stableStringify(entry) && !args.force) {
    logErr(`A server named "${args.name}" already exists and differs.`);
    console.error(`\nFile: ${configPath}\n`);
    console.error(`Re-run with --force to overwrite, or choose a different name with --name.\n`);
    console.error(`Tip: open the config folder with:\n  ${openFolderHint(configPath)}\n`);
    process.exit(2);
  }

  const patch = {
    mcpServers: {
      ...(current.mcpServers || {}),
      [args.name]: entry,
    },
  };

  // --- Idempotent no-op detection ---
  const merged = deepMerge(current, patch);
  const currentStr = JSON.stringify(current, null, 2) + "\n";
  const mergedStr = JSON.stringify(merged, null, 2) + "\n";

  if (currentStr === mergedStr) {
    logOk("No changes needed (already configured).");
    console.log(`   Path: ${configPath}`);
    console.log(`\n📂 Helpful:\n  ${openFolderHint(configPath)}`);

    // No-op UX: don't tell them to restart
    console.log(`\nYou're already configured! 🎉`);
    console.log(`Tiger Den MCP is already installed in Claude Desktop.`);
    if (!isClaudeRunning()) {
      console.log(`\nStart Claude Desktop to begin using it.`);
    } else {
      console.log(`\nYou should already see "${args.name}" available in Claude.`);
    }
    return;
  }
  // --- End idempotent no-op detection ---

  if (!args.quiet) logStep(4, "Write config (with backup)");
  const bak = backup(configPath);
  fs.writeFileSync(configPath, mergedStr, "utf8");

  logOk("Updated Claude Desktop config file");
  console.log(`   Path: ${configPath}`);
  if (bak) console.log(`🧾 Backup: ${bak}`);
  console.log(`🔧 Added/updated MCP server: ${args.name}`);
  console.log(`   Command: ${entry.command}`);

  console.log(`\n📂 Helpful:\n  ${openFolderHint(configPath)}`);

  if (!token) {
    logWarn("Placeholder token written.");
    console.log(`   Edit this value in the config file: Authorization: Bearer td_your_key_here`);
  }

  // Only suggest restart when we actually wrote changes
  console.log(`\nNext steps:`);
  const running = isClaudeRunning();
  if (running) {
    logWarn("Claude Desktop appears to be running.");
    console.log(`   Please fully quit and restart Claude Desktop to load the MCP server.`);
  } else {
    console.log(`  Start Claude Desktop to load the MCP server.`);
  }
  console.log(`  Confirm "${args.name}" appears as an MCP server.`);
}

main().catch((e) => {
  logErr("Setup failed.");
  console.error(`\n${e.message}\n`);
  process.exit(1);
});