# 🦙 Ollama Open Design — Local LLM Integration

<div align="center">

**Run AI-powered design generation with your local Ollama models — no API keys, no cloud, zero cost.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Ollama](https://img.shields.io/badge/Ollama-Local_LLM-black?logo=ollama)](https://ollama.com)
[![Open Design](https://img.shields.io/badge/Open_Design-Compatible-orange)](https://github.com/nicepkg/open-design)

</div>

---

## 📖 What Is This?

This is an **Ollama Local LLM integration** addon for [Open Design](https://github.com/nicepkg/open-design) — the open-source AI design tool by Neru Labs.

It enables users to run **any locally installed Ollama model** (llama3, qwen3, mistral, codellama, etc.) directly inside Open Design, without needing any API key or cloud service.

### ✨ Key Features

| Feature | Description |
|---|---|
| 🔍 **Auto-Discovery** | Automatically detects all Ollama models installed on your system |
| 🚀 **Zero API Key** | No API keys, no cloud accounts — everything runs locally |
| 💰 **Zero Cost** | Local models = $0.00 per generation |
| 🔒 **Privacy** | Your prompts and designs never leave your machine |
| 📡 **HTTP Streaming** | Real-time token streaming via Ollama's NDJSON API |
| 🖥️ **Cross-Platform** | Works on Windows, macOS, and Linux |
| 🔌 **Plug & Play** | Appears in Open Design's agent picker automatically |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Browser (Web UI)                   │
│                                                      │
│   ┌─────────────┐    ┌──────────────────────────┐   │
│   │ Agent Picker │───▶│  Model Dropdown           │   │
│   │  [Ollama ▾]  │    │  ┌─ qwen3:14b (8.6 GB)   │   │
│   └─────────────┘    │  ├─ llama3:8b (4.7 GB)    │   │
│                      │  ├─ mistral (4.1 GB)      │   │
│                      │  └─ codellama (3.8 GB)    │   │
│                      └──────────────────────────┘   │
└───────────────────────┬──────────────────────────────┘
                        │ SSE (Server-Sent Events)
                        ▼
┌──────────────────────────────────────────────────────┐
│               Daemon (Node.js Backend)                │
│                                                      │
│   ┌──────────────┐    ┌─────────────────────────┐   │
│   │  agents.ts   │───▶│   ollama-stream.ts       │   │
│   │  (Registry)  │    │   ┌─ detectOllama()      │   │
│   │              │    │   ├─ fetchOllamaModels() │   │
│   │  server.ts   │    │   └─ startOllamaStream() │   │
│   │  (HTTP Path) │    └──────────┬──────────────┘   │
│   └──────────────┘               │                   │
└──────────────────────────────────┼───────────────────┘
                                   │ HTTP (fetch)
                                   ▼
┌──────────────────────────────────────────────────────┐
│            Ollama Service (localhost:11434)            │
│                                                      │
│   GET  /api/tags  →  List all installed models       │
│   POST /api/chat  →  Stream chat completions (NDJSON)│
│                                                      │
│   Models: llama3, qwen3, mistral, codellama, etc.    │
└──────────────────────────────────────────────────────┘
```

### Why HTTP Instead of CLI?

Most agents in Open Design work by **spawning a CLI subprocess** (e.g., `claude --prompt "..."`). Ollama is different — its native interface is an **HTTP REST API**.

This is actually **better** because:
1. **No CORS issues** — the daemon proxies requests to `localhost:11434`
2. **No command-line length limits** — HTTP bodies have no size cap (Windows `ENAMETOOLONG` problem doesn't apply)
3. **No PATH detection required** — works even if the `ollama` CLI isn't on PATH, as long as the service is running
4. **Streaming via NDJSON** — Ollama streams responses line-by-line, parsed in real-time

---

## 🔧 Problem & Solution

### The Problem: Browser CORS Restrictions

When Open Design runs in a web browser, JavaScript **cannot directly call** `http://localhost:11434` because of CORS (Cross-Origin Resource Sharing) restrictions. The browser blocks it.

```
Browser (http://127.0.0.1:47680)
    │
    ├──✗──▶ http://localhost:11434/api/chat   ← BLOCKED by CORS!
    │
```

### The Solution: Daemon HTTP Proxy

Route Ollama requests through the Open Design daemon (Node.js backend), which has **no CORS restrictions**:

```
Browser (http://127.0.0.1:47680)
    │
    ├──✓──▶ Daemon (http://127.0.0.1:47651/api/chat)
    │              │
    │              └──✓──▶ Ollama (http://localhost:11434/api/chat)
    │                          │
    │              ◀──────────┘  NDJSON stream
    │
    ◀──────SSE stream──────────┘
```

This fits the existing architecture perfectly — other agents already work through the daemon.

---

## 📁 Files Changed

### New File

| File | Purpose |
|---|---|
| `apps/daemon/src/ollama-stream.ts` | Core Ollama HTTP streaming handler |

Contains 4 key functions:

```typescript
// Check if Ollama is running
resolveOllamaHost()     // → "http://127.0.0.1:11434" (or OLLAMA_HOST env var)

// Auto-detect Ollama + list models
detectOllama()          // → { host, models[] } or null

// Fetch models for UI model picker
fetchOllamaModels()     // → [{ id: "llama3", label: "llama3 (4.7 GB)" }, ...]

// Stream chat completion
startOllamaStream()     // → { cancel(), promise }
```

### Modified Files

| File | What Changed |
|---|---|
| `apps/daemon/src/agents.ts` | Added Ollama to `AGENT_DEFS` + HTTP-based probe fallback |
| `apps/daemon/src/server.ts` | Added `ollama-http` stream format + HTTP streaming path |

---

## 📋 Step-by-Step Installation Guide

### Prerequisites

1. **Ollama** installed and running — [Download Ollama](https://ollama.com/download)
2. **Open Design** project cloned — [GitHub Repo](https://github.com/nicepkg/open-design)
3. **Node.js 20+** and **pnpm** installed

### Step 1: Verify Ollama is Running

```bash
# Check Ollama is running
curl http://localhost:11434/

# Should return: "Ollama is running"

# List your installed models
curl http://localhost:11434/api/tags

# Pull a model if you don't have one
ollama pull llama3
ollama pull qwen3:14b
```

### Step 2: Copy the New File

Copy `ollama-stream.ts` into your Open Design project:

```bash
# From your Open Design project root:
cp /path/to/ollama-open-design/src/ollama-stream.ts apps/daemon/src/ollama-stream.ts
```

### Step 3: Apply the Patch

Apply the changes to `agents.ts` and `server.ts`:

```bash
# From your Open Design project root:
git apply /path/to/ollama-open-design/patches/ollama-integration.patch
```

Or manually apply the changes — see the [Detailed Changes](#-detailed-changes-manual-method) section below.

### Step 4: Build and Start Open Design

You can run Open Design either as a local Web App or build it into a Windows Executable (`.exe`).

**Option A: Run as a Local Web App**
1. Open your terminal and go to the `open-design-main` folder:
   ```bash
   cd /path/to/open-design-main
   ```
2. Start the local development server:
   ```bash
   pnpm tools-dev run web
   ```
3. Open the URL shown in your terminal (usually `http://127.0.0.1:47680`).

**Option B: Build as a Windows Executable (.exe)**
1. Open your terminal and go to the `open-design-main` folder:
   ```bash
   cd /path/to/open-design-main
   ```
2. Build the web assets:
   ```bash
   pnpm run build
   ```
3. Package the application into an `.exe` installer:
   ```bash
   pnpm run tools-pack win build --to all
   ```
4. Find your generated `.exe` installer in:
   `.tmp/tools-pack/out/win/namespaces/default/builder/`

### Step 5: Select Ollama in the UI

1. Open your browser at the URL shown (e.g., `http://127.0.0.1:47680`)
2. In the **"Set up Open Design"** dialog, scroll down to find **"Ollama (Local LLM)"**
3. Click on it — you'll see your version (e.g., "ollama version is 0.22.1")
4. Select a **model** from the dropdown (shows all your installed models with sizes)
5. Click **"Get started"** and start designing!

---

## 🔍 Detailed Changes (Manual Method)

If you prefer to apply changes manually instead of using the patch file:

### File 1: `apps/daemon/src/agents.ts`

#### Change 1: Add import (top of file)

```diff
 import { detectAcpModels } from './acp.js';
 import { parsePiModels } from './pi-rpc.js';
+import { fetchOllamaModels } from './ollama-stream.js';
```

#### Change 2: Add Ollama agent definition (end of AGENT_DEFS array, before `];`)

```diff
     buildArgs: () => ['acp'],
     streamFormat: 'acp-json-rpc',
   },
+  {
+    id: 'ollama',
+    name: 'Ollama (Local LLM)',
+    bin: 'ollama',
+    versionArgs: ['--version'],
+    fetchModels: async (_resolvedBin) => fetchOllamaModels(DEFAULT_MODEL_OPTION),
+    fallbackModels: [
+      DEFAULT_MODEL_OPTION,
+      { id: 'llama3', label: 'Llama 3' },
+      { id: 'llama3.1', label: 'Llama 3.1' },
+      { id: 'llama3.2', label: 'Llama 3.2' },
+      { id: 'mistral', label: 'Mistral 7B' },
+      { id: 'qwen2.5-coder', label: 'Qwen 2.5 Coder' },
+      { id: 'codellama', label: 'Code Llama' },
+      { id: 'deepseek-coder-v2', label: 'DeepSeek Coder V2' },
+      { id: 'gemma2', label: 'Gemma 2' },
+      { id: 'phi3', label: 'Phi-3' },
+    ],
+    buildArgs: () => [],
+    promptViaStdin: false,
+    streamFormat: 'ollama-http',
+  },
 ];
```

#### Change 3: Add HTTP detection in `probe()` function

Find the `probe()` function and add HTTP fallback:

```diff
 async function probe(def) {
   const resolved = resolveOnPath(def.bin);
   if (!resolved) {
+    // For Ollama: even without the CLI on PATH, the HTTP service may be
+    // running (e.g. installed as a system service). Try HTTP detection.
+    if (def.streamFormat === 'ollama-http' && typeof def.fetchModels === 'function') {
+      try {
+        const models = await def.fetchModels(null);
+        if (models && models.length > 0) {
+          return {
+            ...stripFns(def),
+            models,
+            available: true,
+            path: null,
+            version: 'HTTP service detected',
+          };
+        }
+      } catch {
+        // HTTP detection failed — fall through to unavailable
+      }
+    }
     return {
       ...stripFns(def),
```

---

### File 2: `apps/daemon/src/server.ts`

#### Change 1: Add import (near other stream imports)

```diff
 import { createClaudeStreamHandler } from './claude-stream.js';
 import { createCopilotStreamHandler } from './copilot-stream.js';
 import { createJsonEventStreamHandler } from './json-event-stream.js';
+import { startOllamaStream } from './ollama-stream.js';
```

#### Change 2: Skip bin check for Ollama (in `startChatRun`)

```diff
     if (!def) return design.runs.fail(run, 'AGENT_UNAVAILABLE', `unknown agent: ${agentId}`);
-    if (!def.bin) return design.runs.fail(run, 'AGENT_UNAVAILABLE', 'agent has no binary');
+    // Ollama uses HTTP (not a CLI binary) — skip the bin check for it.
+    if (!def.bin && def.streamFormat !== 'ollama-http') return design.runs.fail(run, 'AGENT_UNAVAILABLE', 'agent has no binary');
```

#### Change 3: Add Ollama HTTP path (after `send` is defined, before `resolvedBin` check)

```diff
     const send = (event, data) => design.runs.emit(run, event, data);

+    // ---- Ollama HTTP path --------------------------------------------------
+    // Ollama communicates via HTTP REST API (localhost:11434), not a CLI
+    // subprocess. When the agent is Ollama, skip the entire spawn flow and
+    // stream the response directly from the Ollama HTTP API.
+    if (def.streamFormat === 'ollama-http') {
+      const ollamaModel = safeModel && safeModel !== 'default' ? safeModel : 'llama3';
+
+      if (run.cancelRequested || design.runs.isTerminal(run.status)) return;
+
+      run.status = 'running';
+      run.updatedAt = Date.now();
+      send('start', {
+        runId: run.id,
+        agentId,
+        bin: 'ollama (HTTP)',
+        streamFormat: 'ollama-http',
+        projectId: typeof projectId === 'string' ? projectId : null,
+        cwd,
+        model: ollamaModel,
+        reasoning: null,
+      });
+
+      const ollama = startOllamaStream({
+        model: ollamaModel,
+        prompt: composed,
+        send,
+      });
+
+      // Wire cancellation: when the run is cancelled, abort the HTTP request.
+      run.child = {
+        kill: () => ollama.cancel(),
+        killed: false,
+        pid: null,
+      };
+
+      // Wait for stream completion and finalize the run.
+      ollama.promise
+        .then(() => {
+          if (!run.cancelRequested) {
+            design.runs.finish(run, 'succeeded', 0, null);
+          } else {
+            design.runs.finish(run, 'canceled', 0, null);
+          }
+        })
+        .catch((err) => {
+          send('error', createSseErrorPayload('AGENT_EXECUTION_FAILED', err.message));
+          design.runs.finish(run, 'failed', 1, null);
+        });
+
+      return; // Skip the CLI subprocess path below
+    }
+
     // resolvedBin was already looked up above...
```

---

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Custom Ollama host URL |

### Supported Models

Any model installed via `ollama pull` works automatically. Popular choices:

| Model | Command | Size | Best For |
|---|---|---|---|
| Llama 3 | `ollama pull llama3` | 4.7 GB | General purpose |
| Qwen 3 14B | `ollama pull qwen3:14b` | 8.6 GB | Coding + reasoning |
| Qwen 2.5 Coder | `ollama pull qwen2.5-coder` | 4.7 GB | Code generation |
| Mistral 7B | `ollama pull mistral` | 4.1 GB | Fast general purpose |
| Code Llama | `ollama pull codellama` | 3.8 GB | Code-specific tasks |
| DeepSeek Coder V2 | `ollama pull deepseek-coder-v2` | 8.9 GB | Advanced coding |
| Gemma 2 | `ollama pull gemma2` | 5.4 GB | Google's open model |

---

## 🐛 Troubleshooting

### Ollama not detected?

```bash
# Check if Ollama is running
curl http://localhost:11434/
# Expected: "Ollama is running"

# If not running, start it:
ollama serve
```

### No models showing?

```bash
# Check installed models
ollama list

# If empty, pull a model:
ollama pull llama3
```

### Custom Ollama host?

```bash
# Set environment variable before starting Open Design
export OLLAMA_HOST=http://192.168.1.100:11434
pnpm tools-dev run web
```

### CORS errors in browser console?

This should NOT happen with this integration because all Ollama requests go through the daemon. If you see CORS errors, make sure you're using the daemon URL, not calling Ollama directly from the browser.

---

## 📄 License

This project is licensed under **GNU Affero General Public License v3.0 (AGPL-3.0)**.

- ✅ Free for personal, educational, and open source use
- ✅ You can modify and distribute freely
- ⚠️ If you use this in a network service, you MUST release your full source code
- 📧 For commercial/proprietary licensing, contact: **cybermadhan01** on GitHub

See [LICENSE](LICENSE) for the full license text.
See [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md) for commercial licensing information.

> **Note:** This addon integrates with [Open Design](https://github.com/nicepkg/open-design) which is licensed under Apache 2.0. The original Open Design code retains its Apache 2.0 license. This AGPL-3.0 license applies only to the Ollama integration code in this repository.

---

## 🙏 Credits

- **[Open Design](https://github.com/nicepkg/open-design)** by Neru Labs — the base design tool
- **[Ollama](https://ollama.com)** — local LLM runtime
- **cybermadhan01** — Ollama integration development

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork this repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
