import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { HttpError, type RouteParams, protectedRoute, readJson } from "@/lib/http";
import { isPromptName } from "@/lib/ids";
import { deletePrompt, readPrompt, savePrompt } from "@/lib/prompts";
import { savePromptSchema } from "@/lib/schemas";

type Params = RouteParams<{ name: string }>;

async function promptNameFrom(context: Params): Promise<string> {
  const { name } = await context.params;
  if (!isPromptName(name)) {
    throw new HttpError(400, "Prompt names use lowercase letters, digits, dashes and underscores");
  }
  return name;
}

export const GET = protectedRoute(async (_request: NextRequest, context: Params) => {
  const name = await promptNameFrom(context);
  const text = await readPrompt(name);
  if (text === null) throw new HttpError(404, "Prompt not found");
  return NextResponse.json({ name, text }, { headers: { "Cache-Control": "no-store" } });
});

export const PUT = protectedRoute(async (request: NextRequest, context: Params) => {
  const name = await promptNameFrom(context);
  const { text } = await readJson(request, savePromptSchema);
  await savePrompt(name, text);
  revalidatePath("/prompts");
  return NextResponse.json({ name, text });
});

export const DELETE = protectedRoute(async (_request: NextRequest, context: Params) => {
  const name = await promptNameFrom(context);
  await deletePrompt(name);
  revalidatePath("/prompts");
  return NextResponse.json({ ok: true });
});
