import { NextResponse } from "next/server";

import { generateTeachingResearchMarkdown, type ModelSettings } from "@/lib/llm";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      input?: unknown;
      context?: unknown;
      modelType?: unknown;
      knowledgeBaseText?: unknown;
      modelSettings?: unknown;
      systemPromptOverride?: unknown;
      subjectPromptOverride?: unknown;
    };
    const input = typeof body?.input === "string" ? body.input : "";
    const context = typeof body?.context === "string" ? body.context : "";
    const modelType = typeof body?.modelType === "string" ? body.modelType : "domestic";
    const knowledgeBaseText = typeof body?.knowledgeBaseText === "string" ? body.knowledgeBaseText : "";
    const systemPromptOverride =
      typeof body?.systemPromptOverride === "string" ? body.systemPromptOverride : undefined;
    const subjectPromptOverride =
      typeof body?.subjectPromptOverride === "string" ? body.subjectPromptOverride : undefined;
    const modelSettings =
      body?.modelSettings && typeof body.modelSettings === "object"
        ? (body.modelSettings as ModelSettings)
        : {};

    if (!input.trim()) {
      return NextResponse.json(
        { error: "缺少参数：input（任务输入文本不能为空）。" },
        { status: 400 },
      );
    }

    const content = await generateTeachingResearchMarkdown(
      input,
      context,
      modelType,
      knowledgeBaseText,
      modelSettings,
      systemPromptOverride,
      subjectPromptOverride,
    );
    return NextResponse.json({ content });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "接口异常：未知错误。";

    const isMissingKey =
      typeof message === "string" &&
      (message.includes("GEMINI_API_KEY") || message.includes("未配置"));

    return NextResponse.json(
      { error: message },
      { status: isMissingKey ? 500 : 502 },
    );
  }
}

