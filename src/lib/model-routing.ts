import type { ModelProvider } from "@/lib/llm";
import type { RoleName } from "@/lib/agents/roles";

export type WritingLanguage = "zh" | "en";

export interface ProviderSettings {
  ideaProvider?: ModelProvider;
  structureProvider?: ModelProvider;
  reviewProvider?: ModelProvider;
  chineseWritingProvider?: ModelProvider;
  englishWritingProvider?: ModelProvider;
}

export const DEFAULT_PROVIDER_SETTINGS: Required<ProviderSettings> = {
  ideaProvider: "gpt",
  structureProvider: "claude-code",
  reviewProvider: "gemini",
  chineseWritingProvider: "deepseek",
  englishWritingProvider: "gpt",
};

function writingProvider(settings: Required<ProviderSettings>, language?: WritingLanguage): ModelProvider {
  return language === "en" ? settings.englishWritingProvider : settings.chineseWritingProvider;
}

export function normalizeProviderSettings(settings?: ProviderSettings): Required<ProviderSettings> {
  return {
    ...DEFAULT_PROVIDER_SETTINGS,
    ...settings,
  };
}

export function routeProviderForRole(
  role: RoleName,
  requestedProvider: ModelProvider = "claude-code",
  settings?: ProviderSettings,
  language: WritingLanguage = "zh",
): ModelProvider {
  if (!settings && requestedProvider !== "claude-code") return requestedProvider;

  const resolved = normalizeProviderSettings(settings);
  switch (role) {
    case "idea":
      return resolved.ideaProvider;
    case "architect":
    case "worldbuilder":
      return resolved.structureProvider;
    case "editor":
    case "reviewer":
    case "reader":
    case "continuity":
    case "chronicler":
      return resolved.reviewProvider;
    case "writer":
    case "character":
      return writingProvider(resolved, language);
    default:
      return writingProvider(resolved, language);
  }
}
