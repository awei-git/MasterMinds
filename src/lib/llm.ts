import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// --- Types ---

export type ModelProvider = "claude" | "gpt" | "deepseek" | "gemini";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

// Max output tokens per provider (including thinking/reasoning tokens)
const MAX_OUTPUT: Record<ModelProvider, number> = {
  claude: 64000,
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

const MODEL_DEFAULTS: Record<ModelProvider, string> = {
  claude: "claude-sonnet-4-6",
  gpt: "gpt-5.4",
  deepseek: "deepseek-reasoner",
  gemini: "gemini-3.1-pro",
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

// --- Non-streaming completion ---

export async function complete(
  provider: ModelProvider,
  messages: LLMMessage[],
  opts: LLMOptions = {}
): Promise<string> {
  const maxTokens = opts.maxTokens ?? MAX_OUTPUT[provider];

  if (provider === "claude") {
    const client = getAnthropic();
    const userMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const systemText =
      opts.system || messages.find((m) => m.role === "system")?.content;

    const response = await client.messages.create({
      model: opts.model ?? MODEL_DEFAULTS.claude,
      max_tokens: maxTokens,
      temperature: 1, // required for extended thinking
      thinking: { type: "enabled", budget_tokens: 16000 },
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

  // GPT and DeepSeek reasoner: use max_completion_tokens, no temperature
  // Gemini: use max_tokens with temperature
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

// --- Streaming completion ---

export async function stream(
  provider: ModelProvider,
  messages: LLMMessage[],
  opts: LLMOptions = {},
  callbacks: StreamCallbacks
): Promise<void> {
  const maxTokens = opts.maxTokens ?? MAX_OUTPUT[provider];
  let fullText = "";

  try {
    if (provider === "claude") {
      const client = getAnthropic();
      const userMessages = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      const systemText =
        opts.system || messages.find((m) => m.role === "system")?.content;

      const s = client.messages.stream({
        model: opts.model ?? MODEL_DEFAULTS.claude,
        max_tokens: maxTokens,
        temperature: 1,
        thinking: { type: "enabled", budget_tokens: 16000 },
        ...(systemText ? { system: systemText } : {}),
        messages: userMessages,
      });

      for await (const event of s) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          // Only stream text blocks, skip thinking blocks
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
        // Only stream content, skip reasoning tokens
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          callbacks.onText(delta);
        }
      }
    }

    callbacks.onDone(fullText);
  } catch (error) {
    if (callbacks.onError) {
      callbacks.onError(error as Error);
    } else {
      throw error;
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
