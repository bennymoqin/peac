import { NextResponse } from "next/server";

export const runtime = "nodejs";

type MutablePdfGlobal = typeof globalThis & {
  DOMMatrix?: typeof DOMMatrix;
  ImageData?: typeof ImageData;
  Path2D?: typeof Path2D;
};

class FallbackDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(value?: Partial<FallbackDOMMatrix> | number[]) {
    if (Array.isArray(value)) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = [
        value[0] ?? 1,
        value[1] ?? 0,
        value[2] ?? 0,
        value[3] ?? 1,
        value[4] ?? 0,
        value[5] ?? 0,
      ];
    } else if (value && typeof value === "object") {
      this.a = value.a ?? this.a;
      this.b = value.b ?? this.b;
      this.c = value.c ?? this.c;
      this.d = value.d ?? this.d;
      this.e = value.e ?? this.e;
      this.f = value.f ?? this.f;
    }
  }

  multiplySelf(value?: Partial<FallbackDOMMatrix> | number[]) {
    const next = new FallbackDOMMatrix(value);
    const a = this.a * next.a + this.c * next.b;
    const b = this.b * next.a + this.d * next.b;
    const c = this.a * next.c + this.c * next.d;
    const d = this.b * next.c + this.d * next.d;
    const e = this.a * next.e + this.c * next.f + this.e;
    const f = this.b * next.e + this.d * next.f + this.f;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  translateSelf(x = 0, y = 0) {
    this.e += x;
    this.f += y;
    return this;
  }

  scaleSelf(x = 1, y = x) {
    this.a *= x;
    this.d *= y;
    return this;
  }
}

class FallbackImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(data: Uint8ClampedArray, width: number, height?: number) {
    this.data = data;
    this.width = width;
    this.height = height ?? Math.floor(data.length / 4 / Math.max(width, 1));
  }
}

class FallbackPath2D {}

function ensurePdfGeometryGlobals() {
  const target = globalThis as MutablePdfGlobal;
  target.DOMMatrix ||= FallbackDOMMatrix as unknown as typeof DOMMatrix;
  target.ImageData ||= FallbackImageData as unknown as typeof ImageData;
  target.Path2D ||= FallbackPath2D as unknown as typeof Path2D;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "未检测到上传的文件。" }, { status: 400 });
    }

    let text = "";
    if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      const buffer = Buffer.from(await file.arrayBuffer());
      ensurePdfGeometryGlobals();
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const pdfData = await parser.getText();
      await parser.destroy();
      text = pdfData.text;
    } else {
      text = await file.text();
    }

    return NextResponse.json({ content: text });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: "文件解析失败: " + message }, { status: 500 });
  }
}
