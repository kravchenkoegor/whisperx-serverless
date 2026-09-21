export const WHISPER_PROMPT_TOKEN_LIMIT = 223;
export const WHISPER_PROMPT_TOKEN_WARNING = 200;

const TOKENIZER_MODEL = "openai/whisper-large-v3";

type PromptTokenCounter = (prompt: string) => number;

let counterPromise: Promise<PromptTokenCounter> | null = null;

async function createCounter(): Promise<PromptTokenCounter> {
  const { AutoTokenizer, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  const tokenizer = await AutoTokenizer.from_pretrained(TOKENIZER_MODEL);
  return (prompt) => {
    const trimmed = prompt.trim();
    if (!trimmed) return 0;
    return tokenizer.encode(` ${trimmed}`, { add_special_tokens: false }).length;
  };
}

export function loadPromptTokenCounter(): Promise<PromptTokenCounter> {
  counterPromise ??= createCounter().catch((error: unknown) => {
    counterPromise = null;
    throw error;
  });
  return counterPromise;
}
