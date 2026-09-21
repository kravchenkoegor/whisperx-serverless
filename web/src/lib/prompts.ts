import { PROMPTS_PREFIX, isPromptName, promptKey } from "./ids";
import { deleteObject, getObjectText, listObjects, putObjectText } from "./r2";
import type { PromptSummary } from "./types";

export async function listPrompts(): Promise<PromptSummary[]> {
  const objects = await listObjects(PROMPTS_PREFIX);
  return objects
    .flatMap((object) => {
      const name = object.key.slice(PROMPTS_PREFIX.length).replace(/\.txt$/, "");
      if (!isPromptName(name) || promptKey(name) !== object.key) return [];
      return [{ name, size: object.size, updatedAt: object.lastModified }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readPrompt(name: string): Promise<string | null> {
  return getObjectText(promptKey(name));
}

export function savePrompt(name: string, text: string): Promise<void> {
  return putObjectText(promptKey(name), text, "text/plain; charset=utf-8");
}

export function deletePrompt(name: string): Promise<void> {
  return deleteObject(promptKey(name));
}
