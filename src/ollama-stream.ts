// @ts-nocheck
/**
 * Ollama HTTP streaming handler for Open Design.
 *
 * Connects to a local Ollama instance (default http://localhost:11434) and
 * streams chat completions. Ollama responds with newline-delimited JSON
 * (NDJSON) — each line is a partial response object with a `message.content`
 * delta and metadata.
 *
 * This module maps those into the same UI-friendly events the rest of the
 * Open Design daemon expects:
 *
 *   - status       : lifecycle ("connecting", "streaming", "done")
 *   - text_delta   : assistant text chunk
 *   - usage        : token counts (when available)
 *   - error        : connection or model errors
 *
 * Unlike CLI-based agents, Ollama communicates over HTTP — there is no child
 * process to spawn. The daemon calls `startOllamaStream()` which returns a
 * cancel handle. All model interaction happens through the Ollama REST API,
 * so **no API key is required** — just a running Ollama instance.
 *
 * @author cybermadhan01
 * @license AGPL-3.0
 */

const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';

/**
 * Resolve the Ollama host URL. Users can override via OLLAMA_HOST env var
 * (same env var Ollama's own CLI and SDKs respect).
 */
export function resolveOllamaHost() {
  const env = process.env.OLLAMA_HOST;
  if (typeof env === 'string' && env.trim().length > 0) {
    const host = env.trim();
    return host.startsWith('http') ? host : `http://${host}`;
  }
  return DEFAULT_OLLAMA_HOST;
}

/**
 * Check whether Ollama is reachable by hitting GET /api/tags.
 * Returns the list of installed models on success, or null on failure.
 */
export async function detectOllama() {
  const host = resolveOllamaHost();
  try {
    const res = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models : [];
    return { host, models };
  } catch {
    return null;
  }
}

/**
 * Fetch the list of locally installed Ollama models. Returns an array of
 * `{ id, label }` option objects compatible with the agent model picker,
 * or `null` if Ollama is unreachable.
 */
export async function fetchOllamaModels(defaultModelOption) {
  const detection = await detectOllama();
  if (!detection || detection.models.length === 0) return null;

  const list = [defaultModelOption];
  const seen = new Set();
  for (const m of detection.models) {
    const name = m.name || m.model;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const sizeGb = m.size ? `${(m.size / (1024 ** 3)).toFixed(1)} GB` : null;
    const label = sizeGb ? `${name} (${sizeGb})` : name;
    list.push({ id: name, label });
  }
  return list;
}

/**
 * Start a streaming chat completion against a local Ollama instance.
 *
 * @param {object} params
 * @param {string} params.model   - The Ollama model name (e.g. "llama3")
 * @param {string} params.prompt  - The composed prompt (system + user)
 * @param {(event: string, data: any) => void} params.send - SSE emitter
 * @returns {{ cancel: () => void, promise: Promise<void> }}
 */
export function startOllamaStream({ model, prompt, send }) {
  const host = resolveOllamaHost();
  let abortController = new AbortController();
  let cancelled = false;

  const run = async () => {
    send('agent', { type: 'status', label: 'connecting', model });

    const payload = {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    };

    let response;
    try {
      response = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });
    } catch (err) {
      if (cancelled) return;
      const msg = err.name === 'AbortError'
        ? 'Ollama request was cancelled'
        : `Could not connect to Ollama at ${host}. Is Ollama running? (${err.message})`;
      send('agent', { type: 'error', error: msg });
      return;
    }

    if (!response.ok) {
      let errorText = '';
      try { errorText = await response.text(); } catch { /* ignore */ }
      send('agent', {
        type: 'error',
        error: `Ollama returned HTTP ${response.status}: ${errorText || 'unknown error'}`,
      });
      return;
    }

    send('agent', { type: 'status', label: 'streaming' });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalTokens = { promptTokens: 0, completionTokens: 0 };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled) break;

        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;

          let obj;
          try { obj = JSON.parse(line); } catch { continue; }

          // Stream text deltas
          if (obj.message && typeof obj.message.content === 'string' && obj.message.content.length > 0) {
            send('agent', { type: 'text_delta', delta: obj.message.content });
          }

          // Final message — extract usage stats
          if (obj.done === true) {
            if (obj.prompt_eval_count) totalTokens.promptTokens = obj.prompt_eval_count;
            if (obj.eval_count) totalTokens.completionTokens = obj.eval_count;

            send('agent', {
              type: 'usage',
              usage: {
                input_tokens: totalTokens.promptTokens,
                output_tokens: totalTokens.completionTokens,
              },
              costUsd: 0,
              durationMs: obj.total_duration
                ? Math.round(obj.total_duration / 1_000_000)
                : null,
              stopReason: obj.done_reason || 'stop',
            });
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer.trim());
          if (obj.message?.content) {
            send('agent', { type: 'text_delta', delta: obj.message.content });
          }
        } catch { /* ignore partial */ }
      }
    } catch (err) {
      if (!cancelled) {
        send('agent', { type: 'error', error: `Stream read error: ${err.message}` });
      }
    }
  };

  const promise = run();

  return {
    cancel: () => {
      cancelled = true;
      try { abortController.abort(); } catch { /* ignore */ }
    },
    promise,
  };
}
