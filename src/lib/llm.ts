import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { spawn } from "child_process";

// --- Types ---

export type ModelProvider = "claude" | "claude-code" | "gpt" | "deepseek" | "gemini";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
  // Enable extended thinking for Claude. Default: false.
  // Use for creative/strategic tasks (write, architect, review).
  // Do NOT use for utility calls (summarize, continuity check, phase summary).
  thinking?: boolean;
  thinkingBudget?: number; // default 16000 when thinking=true
}

// Max output tokens per provider (including thinking/reasoning tokens)
const MAX_OUTPUT: Record<ModelProvider, number> = {
  claude: 64000,
  "claude-code": 64000,
  gpt: 32000,
  deepseek: 16000,
  gemini: 65536,
};

export interface StreamCallbacks {
  onText: (text: string) => void;
  onDone: (fullText: string) => void;
  onError?: (error: Error) => void;
}

// --- Provider defaults ---

// Primary creative model: Claude Opus via Max subscription (or claude-code for free via Claude Max)
// Reviewer/critic models: GPT-5.4, Gemini 2.5 Pro, DeepSeek Reasoner
const MODEL_DEFAULTS: Record<ModelProvider, string> = {
  claude: "claude-opus-4-6",    // Claude API — primary writer, architect, chief editor
  "claude-code": "claude-opus-4-6", // Claude Code CLI — uses Claude Max subscription, no API cost
  gpt: "gpt-5.4",               // Parallel reviewer
  deepseek: "deepseek-reasoner", // Parallel reviewer (reasoning)
  gemini: "gemini-2.5-pro",     // Parallel reviewer (long context, consistency checks)
};

// Lighter model for internal utility calls (summarization, chapter summaries, continuity checks)
export const MODEL_UTILITY: Record<ModelProvider, string> = {
  claude: "claude-sonnet-4-6",
  "claude-code": "claude-sonnet-4-6",
  gpt: "gpt-4.1-mini",
  deepseek: "deepseek-chat",
  gemini: "gemini-2.5-flash",
};

// --- Lazy-init clients ---

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let deepseekClient: OpenAI | null = null;
let geminiClient: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI();
  }
  return openaiClient;
}

function getDeepSeek(): OpenAI {
  if (!deepseekClient) {
    deepseekClient = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
    });
  }
  return deepseekClient;
}

function getGemini(): OpenAI {
  if (!geminiClient) {
    geminiClient = new OpenAI({
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: process.env.GEMINI_API_KEY,
    });
  }
  return geminiClient;
}

// --- Claude Code CLI helpers ---

/**
 * Format messages array into a single prompt string for the Claude CLI.
 * Multi-turn conversations are serialized as a transcript.
 */
function formatMessagesForCLI(messages: LLMMessage[]): string {
  const relevant = messages.filter((m) => m.role !== "system");
  if (relevant.length === 1) return relevant[0].content;
  return relevant
    .map((m) => `[${m.role === "user" ? "Human" : "Assistant"}]\n${m.content}`)
    .join("\n\n");
}

function cliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE; // prevent "nested session" error when running inside Claude Code
  return env;
}

async function completeViaCLI(messages: LLMMessage[], opts: LLMOptions, signal?: AbortSignal): Promise<string> {
  const model = opts.model ?? MODEL_DEFAULTS["claude-code"];
  const prompt = formatMessagesForCLI(messages);
  const args = ["-p", "--output-format", "json", "--model", model, "--tools", ""];
  if (opts.system) args.push("--system-prompt", opts.system);

  return new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, { env: cliEnv() });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timeout = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
      reject(new Error("claude CLI timeout (300s)"));
    }, 300_000);

    if (signal) {
      const onAbort = () => {
        killed = true;
        clearTimeout(timeout);
        child.kill("SIGKILL");
        reject(new Error("CLI aborted by caller"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      child.on("close", () => signal.removeEventListener("abort", onAbort));
    }

    child.stdin.write(prompt);
    child.stdin.end();
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (killed) return;
      if (code !== 0) return reject(new Error(`claude CLI error: ${stderr}`));
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed.result ?? "");
      } catch {
        resolve(stdout.trim());
      }
    });
  });
}

async function streamViaCLI(
  messages: LLMMessage[],
  opts: LLMOptions,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const model = opts.model ?? MODEL_DEFAULTS["claude-code"];
  const prompt = formatMessagesForCLI(messages);
  const args = ["-p", "--output-format", "text", "--model", model, "--tools", ""];
  if (opts.system) args.push("--system-prompt", opts.system);

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { env: cliEnv() });
    let fullText = "";
    let stderr = "";
    let lastDataAt = Date.now();
    let killed = false;
    const staleCheck = setInterval(() => {
      if (Date.now() - lastDataAt > 300_000) {
        clearInterval(staleCheck);
        killed = true;
        child.kill("SIGKILL");
        reject(new Error("claude CLI timeout — no output for 300s"));
      }
    }, 30_000);

    if (signal) {
      const onAbort = () => {
        clearInterval(staleCheck);
        killed = true;
        child.kill("SIGKILL");
        reject(new Error("CLI aborted by caller"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      child.on("close", () => signal.removeEventListener("abort", onAbort));
    }

    child.stdin.write(prompt);
    child.stdin.end();
    child.stdout.on("data", (d: Buffer) => {
      lastDataAt = Date.now();
      const text = d.toString();
      fullText += text;
      callbacks.onText(text);
    });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      clearInterval(staleCheck);
      if (killed) return;
      if (code !== 0) {
        reject(new Error(`claude CLI error: ${stderr}`));
      } else {
        callbacks.onDone(fullText);
        resolve();
      }
    });
  });
}

// --- Fallback chain: if a provider fails, try claude-code then gpt ---

const FALLBACK_CHAIN: ModelProvider[] = ["claude-code", "gpt"];

function getFallbacks(failedProvider: ModelProvider): ModelProvider[] {
  return FALLBACK_CHAIN.filter((p) => p !== failedProvider);
}

// --- Non-streaming completion ---

async function completeOnce(
  provider: ModelProvider,
  messages: LLMMessage[],
  opts: LLMOptions = {},
  signal?: AbortSignal
): Promise<string> {
  const maxTokens = opts.maxTokens ?? MAX_OUTPUT[provider];

  if (provider === "claude-code") {
    return completeViaCLI(messages, opts, signal);
  }

  if (provider === "claude") {
    const client = getAnthropic();
    const userMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const systemText =
      opts.system || messages.find((m) => m.role === "system")?.content;

    const useThinking = opts.thinking ?? false;
    const response = await client.messages.create({
      model: opts.model ?? MODEL_DEFAULTS.claude,
      max_tokens: maxTokens,
      ...(useThinking
        ? { temperature: 1, thinking: { type: "enabled", budget_tokens: opts.thinkingBudget ?? 16000 } }
        : { temperature: opts.temperature ?? 0.7 }),
      ...(systemText ? { system: systemText } : {}),
      messages: userMessages,
    });

    return response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  }

  // OpenAI-compatible (GPT, DeepSeek, Gemini)
  const client = provider === "gpt" ? getOpenAI() : provider === "gemini" ? getGemini() : getDeepSeek();
  const model = opts.model ?? MODEL_DEFAULTS[provider];

  const allMessages = opts.system
    ? [{ role: "system" as const, content: opts.system }, ...messages.filter((m) => m.role !== "system")]
    : messages;

  const isReasoning = provider === "gpt" || provider === "deepseek";
  const tokenParam = isReasoning
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };

  const response = await client.chat.completions.create({
    model,
    messages: allMessages,
    ...tokenParam,
    ...(provider === "gpt" ? { reasoning_effort: "high" } : {}),
    ...(!isReasoning ? { temperature: opts.temperature ?? 0.7 } : {}),
  });

  return response.choices[0]?.message?.content ?? "";
}

export async function complete(
  provider: ModelProvider,
  messages: LLMMessage[],
  opts: LLMOptions = {},
  signal?: AbortSignal
): Promise<string> {
  try {
    return await completeOnce(provider, messages, opts, signal);
  } catch (err) {
    console.warn(`[llm] ${provider} failed, trying fallback:`, err instanceof Error ? err.message : err);
    for (const fallback of getFallbacks(provider)) {
      try {
        console.log(`[llm] fallback → ${fallback}`);
        return await completeOnce(fallback, messages, opts, signal);
      } catch (fbErr) {
        console.warn(`[llm] fallback ${fallback} also failed:`, fbErr instanceof Error ? fbErr.message : fbErr);
      }
    }
    throw err; // all fallbacks failed, throw original error
  }
}

// --- Streaming completion ---

async function streamOnce(
  provider: ModelProvider,
  messages: LLMMessage[],
  opts: LLMOptions = {},
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const maxTokens = opts.maxTokens ?? MAX_OUTPUT[provider];
  let fullText = "";

  if (provider === "claude-code") {
    return streamViaCLI(messages, opts, callbacks, signal);
  }

  if (provider === "claude") {
    const client = getAnthropic();
    const userMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const systemText =
      opts.system || messages.find((m) => m.role === "system")?.content;

    const useThinking = opts.thinking ?? false;
    const s = client.messages.stream({
      model: opts.model ?? MODEL_DEFAULTS.claude,
      max_tokens: maxTokens,
      ...(useThinking
        ? { temperature: 1, thinking: { type: "enabled", budget_tokens: opts.thinkingBudget ?? 16000 } }
        : { temperature: opts.temperature ?? 0.7 }),
      ...(systemText ? { system: systemText } : {}),
      messages: userMessages,
    });

    for await (const event of s) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        fullText += event.delta.text;
        callbacks.onText(event.delta.text);
      }
    }
  } else {
    // OpenAI-compatible
    const client = provider === "gpt" ? getOpenAI() : provider === "gemini" ? getGemini() : getDeepSeek();
    const model = opts.model ?? MODEL_DEFAULTS[provider];

    const allMessages = opts.system
      ? [{ role: "system" as const, content: opts.system }, ...messages.filter((m) => m.role !== "system")]
      : messages;

    const isReasoning = provider === "gpt" || provider === "deepseek";
    const tokenParam = isReasoning
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };

    const s = await client.chat.completions.create({
      model,
      messages: allMessages,
      ...tokenParam,
      ...(provider === "gpt" ? { reasoning_effort: "high" } : {}),
      ...(!isReasoning ? { temperature: opts.temperature ?? 0.7 } : {}),
      stream: true,
    });

    for await (const chunk of s) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        callbacks.onText(delta);
      }
    }
  }

  callbacks.onDone(fullText);
}

export async function stream(
  provider: ModelProvider,
  messages: LLMMessage[],
  opts: LLMOptions = {},
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  try {
    return await streamOnce(provider, messages, opts, callbacks, signal);
  } catch (err) {
    console.warn(`[llm] ${provider} stream failed, trying fallback:`, err instanceof Error ? err.message : err);
    for (const fallback of getFallbacks(provider)) {
      try {
        console.log(`[llm] stream fallback → ${fallback}`);
        return await streamOnce(fallback, messages, opts, callbacks, signal);
      } catch (fbErr) {
        console.warn(`[llm] stream fallback ${fallback} also failed:`, fbErr instanceof Error ? fbErr.message : fbErr);
      }
    }
    // All fallbacks failed — call onError or throw
    if (callbacks.onError) {
      callbacks.onError(err as Error);
    } else {
      throw err;
    }
  }
}

// --- Parallel completion across multiple providers ---

export async function completeParallel(
  providers: ModelProvider[],
  messages: LLMMessage[],
  opts: LLMOptions = {}
): Promise<Record<ModelProvider, string>> {
  const results = await Promise.allSettled(
    providers.map((p) => complete(p, messages, opts))
  );

  const output: Partial<Record<ModelProvider, string>> = {};
  providers.forEach((p, i) => {
    const result = results[i];
    if (result.status === "fulfilled") {
      output[p] = result.value;
    }
  });

  return output as Record<ModelProvider, string>;
}
