import { NextResponse } from "next/server";

import {
  createDocx,
  createLessonPackage,
  createPptx,
  createXlsx,
  sanitizeFileName,
} from "@/lib/office-export";

type ExportKind = "docx" | "pptx" | "xlsx" | "package";

const contentTypes: Record<ExportKind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  package: "application/zip",
};

const extensions: Record<ExportKind, string> = {
  docx: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
  package: "zip",
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      kind?: unknown;
      fileName?: unknown;
      markdown?: unknown;
      lessonTitle?: unknown;
      teachingDesign?: unknown;
      pptScript?: unknown;
      inClassTest?: unknown;
      homework?: unknown;
    };

    const kind = typeof body.kind === "string" ? (body.kind as ExportKind) : undefined;
    if (!kind || !["docx", "pptx", "xlsx", "package"].includes(kind)) {
      return NextResponse.json({ error: "导出类型不支持。" }, { status: 400 });
    }

    const title = typeof body.lessonTitle === "string" ? body.lessonTitle : "教研产出";
    const fileName = sanitizeFileName(typeof body.fileName === "string" ? body.fileName : title);
    const markdown = typeof body.markdown === "string" ? body.markdown : "";

    let bytes: Uint8Array;
    if (kind === "package") {
      bytes = createLessonPackage({
        lessonTitle: title,
        teachingDesign: typeof body.teachingDesign === "string" ? body.teachingDesign : "",
        pptScript: typeof body.pptScript === "string" ? body.pptScript : "",
        inClassTest: typeof body.inClassTest === "string" ? body.inClassTest : "",
        homework: typeof body.homework === "string" ? body.homework : "",
      });
    } else if (kind === "docx") {
      bytes = createDocx(markdown);
    } else if (kind === "pptx") {
      bytes = createPptx(markdown);
    } else {
      bytes = createXlsx(markdown);
    }

    const bodyBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(bodyBuffer).set(bytes);

    return new Response(bodyBuffer, {
      headers: {
        "Content-Type": contentTypes[kind],
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${fileName}.${extensions[kind]}`)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: `导出失败：${message}` }, { status: 500 });
  }
}

