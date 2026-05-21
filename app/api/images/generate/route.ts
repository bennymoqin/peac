import { NextResponse } from "next/server";
import fetch from "node-fetch";
import type { RequestInit } from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";

export const runtime = "nodejs";

type ImageRequest = {
  provider?: unknown;
  prompt?: unknown;
  apiKey?: unknown;
  apiBaseUrl?: unknown;
  proxyUrl?: unknown;
  model?: unknown;
  aspectRatio?: unknown;
  resolution?: unknown;
  thinkingLevel?: unknown;
};

type ImageData = {
  mimeType: string;
  imageBase64: string;
};

type FetchOptions = RequestInit & {
  agent?: unknown;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function errorMessage(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (record.error && typeof record.error === "object") {
      const inner = record.error as Record<string, unknown>;
      if (typeof inner.message === "string") return inner.message;
    }
    if (typeof record.message === "string") return record.message;
  }
  return fallback;
}

function postJson(body: unknown, headers: Record<string, string>, proxyUrl = ""): FetchOptions {
  const options: FetchOptions = {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  };
  if (proxyUrl) options.agent = new HttpsProxyAgent(proxyUrl);
  return options;
}

function mimeFromBytes(bytes: Buffer, contentType = "") {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() || "";
  if (normalized.startsWith("image/")) return normalized;
  if (bytes[0] === 137 && bytes[1] === 80) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
  if (bytes.slice(0, 3).toString("ascii") === "GIF") return "image/gif";
  if (bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return "image/png";
}

function assertLooksLikeImage(bytes: Buffer) {
  const isPng = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const isJpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const isGif = bytes.slice(0, 6).toString("ascii") === "GIF87a" || bytes.slice(0, 6).toString("ascii") === "GIF89a";
  const isWebp = bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP";
  if (bytes.length < 12 || (!isPng && !isJpg && !isGif && !isWebp)) {
    throw new Error(`图片 URL 返回的内容不是有效图片：${bytes.slice(0, 80).toString("utf8")}`);
  }
}

async function downloadImage(url: string, proxyUrl = ""): Promise<ImageData> {
  if (!isHttpUrl(url)) throw new Error("图片 URL 不是有效的 http/https 地址。");
  const options: FetchOptions = {};
  if (proxyUrl) options.agent = new HttpsProxyAgent(proxyUrl);
  const response = await fetch(url, options);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`图片下载失败：${response.status} ${response.statusText}`);
  assertLooksLikeImage(bytes);
  return {
    mimeType: mimeFromBytes(bytes, response.headers.get("content-type") || ""),
    imageBase64: bytes.toString("base64"),
  };
}

function normalizeProvider(value: unknown) {
  const provider = clean(value).toLowerCase();
  if (!provider || provider === "gemini") return "google";
  if (["doubao", "volcano", "volc"].includes(provider)) return "volcengine";
  if (["cogview", "bigmodel"].includes(provider)) return "zhipu";
  if (["dashscope", "wanx", "qwen-image"].includes(provider)) return "aliyun";
  return provider;
}

async function googleImage(body: ImageRequest) {
  let model = clean(body.model) || "gemini-2.5-flash-image";
  const prompt = clean(body.prompt);
  const apiKey = clean(body.apiKey) || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
  const apiBaseUrl = clean(body.apiBaseUrl) || process.env.GOOGLE_IMAGE_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models";
  const proxyUrl = clean(body.proxyUrl) || process.env.HTTPS_PROXY || process.env.https_proxy || "";
  const aspectRatio = clean(body.aspectRatio) || "16:9";
  const resolution = clean(body.resolution) || "2K";
  const thinkingMatch = model.match(/^(gemini-3[.]1-flash-image-preview)__thinking-(low|medium|high)$/);
  let thinkingLevel = clean(body.thinkingLevel).toLowerCase();
  if (thinkingMatch) {
    model = thinkingMatch[1];
    thinkingLevel ||= thinkingMatch[2];
  }

  if (!apiKey) return NextResponse.json({ error: "缺少 Google API Key。" }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: "缺少图片提示词。" }, { status: 400 });
  if (!["gemini-2.5-flash-image", "gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"].includes(model)) {
    return NextResponse.json({ error: "当前只允许调用 Gemini 图像模型白名单。" }, { status: 400 });
  }
  if (!isHttpUrl(apiBaseUrl)) return NextResponse.json({ error: "Google API Base 必须是 http 或 https 地址。" }, { status: 400 });
  if (proxyUrl && !isHttpUrl(proxyUrl)) return NextResponse.json({ error: "代理网关必须是 http 或 https 地址。" }, { status: 400 });

  const payload: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: [prompt, "", `Required aspect ratio: ${aspectRatio}.`, `Requested output quality: ${resolution}.`, "Return one image as the main result."].join("\n") }],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio },
    },
  };
  const generationConfig = payload.generationConfig as Record<string, unknown>;
  const imageConfig = generationConfig.imageConfig as Record<string, unknown>;
  if (model === "gemini-3-pro-image-preview" || model === "gemini-3.1-flash-image-preview") imageConfig.imageSize = resolution;
  if (model === "gemini-3.1-flash-image-preview" && ["low", "medium", "high"].includes(thinkingLevel)) {
    generationConfig.thinkingConfig = { thinkingLevel };
  }

  const base = apiBaseUrl.replace(/\/+$/, "");
  const endpoint = /\/models$/i.test(base)
    ? `${base}/${encodeURIComponent(model)}:generateContent`
    : `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, postJson(payload, { "Content-Type": "application/json", "x-goog-api-key": apiKey }, proxyUrl));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: errorMessage(data, `Google 图像生成请求失败（HTTP ${response.status}）`) },
      { status: response.status },
    );
  }

  const candidates = Array.isArray((data as Record<string, unknown>).candidates)
    ? ((data as Record<string, unknown>).candidates as Array<Record<string, unknown>>)
    : [];
  for (const candidate of candidates) {
    const content = candidate.content as Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? (content.parts as Array<Record<string, unknown>>) : [];
    for (const part of parts) {
      const inlineData = (part.inlineData || part.inline_data) as Record<string, unknown> | undefined;
      if (inlineData && typeof inlineData.data === "string") {
        return NextResponse.json({
          provider: "google",
          model,
          mimeType: clean(inlineData.mimeType) || clean(inlineData.mime_type) || "image/png",
          imageBase64: inlineData.data,
        });
      }
    }
  }

  return NextResponse.json({ error: "Google API 没有返回图片数据。请确认模型权限、API Key 和账号地区是否支持当前图像模型。" }, { status: 502 });
}

async function volcengineImage(body: ImageRequest) {
  const prompt = clean(body.prompt);
  const apiKey = clean(body.apiKey) || process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY || process.env.DOUBAO_API_KEY || "";
  const apiBaseUrl = clean(body.apiBaseUrl) || process.env.VOLCENGINE_API_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3/images/generations";
  const proxyUrl = clean(body.proxyUrl);
  const model = clean(body.model) || "doubao-seedream-5-0-260128";
  const aspectRatio = clean(body.aspectRatio) || "16:9";
  const resolution = clean(body.resolution) || "2K";

  if (!apiKey) return NextResponse.json({ error: "缺少火山方舟 API Key。" }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: "缺少图片提示词。" }, { status: 400 });
  if (!["doubao-seedream-5-0-260128", "doubao-seedream-4-0-250828", "doubao-seedream-4-5-251128"].includes(model)) {
    return NextResponse.json({ error: "当前只允许调用 Seedream 5.0、4.0 或 4.5。" }, { status: 400 });
  }
  if (!isHttpUrl(apiBaseUrl)) return NextResponse.json({ error: "火山 API Base 必须是 http 或 https 地址。" }, { status: 400 });
  if (proxyUrl && !isHttpUrl(proxyUrl)) return NextResponse.json({ error: "代理网关必须是 http 或 https 地址。" }, { status: 400 });

  const payload = {
    model,
    prompt: [prompt, "", `画幅比例：${aspectRatio}。`, `输出清晰度：${resolution}。`, "请返回 1 张图片作为主结果。"].join("\n"),
    sequential_image_generation: "disabled",
    response_format: "url",
    size: resolution,
    stream: false,
    watermark: true,
  };
  const response = await fetch(apiBaseUrl, postJson(payload, { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, proxyUrl));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json({ error: `火山引擎返回 ${response.status}：${errorMessage(data, response.statusText)}` }, { status: response.status });

  const items = Array.isArray((data as Record<string, unknown>).data) ? ((data as Record<string, unknown>).data as Array<Record<string, unknown>>) : [];
  for (const item of items) {
    if (typeof item.b64_json === "string") {
      return NextResponse.json({ provider: "volcengine", model, mimeType: clean(item.mime_type) || clean(item.mimeType) || "image/png", imageBase64: item.b64_json });
    }
    if (typeof item.url === "string") return NextResponse.json({ provider: "volcengine", model, ...(await downloadImage(item.url, proxyUrl)) });
  }
  return NextResponse.json({ error: "火山引擎没有返回图片数据。请确认当前账号已开通所选 Seedream 模型。" }, { status: 502 });
}

async function zhipuImage(body: ImageRequest) {
  const prompt = clean(body.prompt);
  const apiKey = clean(body.apiKey).replace(/^Bearer\s+/i, "") || process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY || "";
  const apiBaseUrl = clean(body.apiBaseUrl) || process.env.ZHIPU_IMAGE_API_BASE_URL || "https://open.bigmodel.cn/api/paas/v4/images/generations";
  const proxyUrl = clean(body.proxyUrl);
  const model = clean(body.model) || "glm-image";
  const aspectRatio = clean(body.aspectRatio) || "16:9";
  const resolution = clean(body.resolution) || "2K";

  if (!apiKey) return NextResponse.json({ error: "Missing Zhipu API Key." }, { status: 400 });
  if (!/^[\x21-\x7e]+$/.test(apiKey) || /^error[:?]/i.test(apiKey)) return NextResponse.json({ error: "Invalid Zhipu API Key. Paste only the API key, not an error message." }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: "Missing image prompt." }, { status: 400 });
  if (!/^(glm-image|cogview-4|cogview-4-250304)$/i.test(model)) return NextResponse.json({ error: "Zhipu channel only supports GLM-Image or CogView-4." }, { status: 400 });
  if (!isHttpUrl(apiBaseUrl)) return NextResponse.json({ error: "Zhipu API Base must be an http/https URL." }, { status: 400 });
  if (proxyUrl && !isHttpUrl(proxyUrl)) return NextResponse.json({ error: "Proxy URL must be an http/https URL." }, { status: 400 });

  const size = ({ "1:1": "1280x1280", "16:9": "1728x960", "4:3": "1472x1088", "3:4": "1088x1472", "9:16": "960x1728" } as Record<string, string>)[aspectRatio] || (/^\d+x\d+$/i.test(aspectRatio) ? aspectRatio : "1728x960");
  const payload: Record<string, unknown> = {
    model,
    prompt: [prompt, "", `Aspect ratio: ${aspectRatio}.`, `Output quality: ${resolution}.`, "For primary-school English teaching slides, prioritize clear Chinese/English text, correct spelling, and projector readability."].join("\n"),
    size,
  };
  if (model.toLowerCase() === "glm-image") payload.quality = "hd";
  const response = await fetch(apiBaseUrl, postJson(payload, { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, proxyUrl));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json({ error: `Zhipu image generation returned ${response.status}: ${errorMessage(data, response.statusText)}` }, { status: response.status });

  const items = Array.isArray((data as Record<string, unknown>).data) ? ((data as Record<string, unknown>).data as Array<Record<string, unknown>>) : [];
  for (const item of items) {
    if (typeof item.b64_json === "string") return NextResponse.json({ provider: "zhipu", model, mimeType: clean(item.mime_type) || clean(item.mimeType) || "image/png", imageBase64: item.b64_json });
    if (typeof item.url === "string") return NextResponse.json({ provider: "zhipu", model, ...(await downloadImage(item.url, proxyUrl)) });
  }
  return NextResponse.json({ error: "Zhipu image generation did not return image data. Confirm the selected model is enabled for your account." }, { status: 502 });
}

async function pollAliyun(taskId: string, baseUrl: string, apiKey: string, proxyUrl = "") {
  const deadline = Date.now() + 120_000;
  const base = baseUrl.replace(/\/+$/, "");
  while (Date.now() <= deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const options: FetchOptions = { headers: { Authorization: `Bearer ${apiKey}` } };
    if (proxyUrl) options.agent = new HttpsProxyAgent(proxyUrl);
    const response = await fetch(`${base}/api/v1/tasks/${encodeURIComponent(taskId)}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Aliyun Wanx task query failed (HTTP ${response.status}): ${errorMessage(data, response.statusText)}`);
    const output = ((data as Record<string, unknown>).output || {}) as Record<string, unknown>;
    const status = String(output.task_status || output.status || "").toUpperCase();
    if (status === "SUCCEEDED") {
      const results = Array.isArray(output.results) ? (output.results as Array<Record<string, unknown>>) : [];
      const result = results.find((item) => typeof item.url === "string" || typeof item.image_url === "string");
      const url = result && (typeof result.url === "string" ? result.url : typeof result.image_url === "string" ? result.image_url : "");
      if (url) return url;
      throw new Error("Aliyun Wanx task succeeded without an image URL.");
    }
    if (["FAILED", "CANCELED", "UNKNOWN"].includes(status)) throw new Error(`Aliyun Wanx task failed: ${output.message || output.code || status}`);
  }
  throw new Error("Aliyun Wanx task timed out.");
}

async function aliyunImage(body: ImageRequest) {
  const prompt = clean(body.prompt);
  const apiKey = clean(body.apiKey) || process.env.DASHSCOPE_API_KEY || process.env.ALIYUN_API_KEY || "";
  const apiBaseUrl = clean(body.apiBaseUrl) || process.env.DASHSCOPE_API_BASE_URL || "https://dashscope.aliyuncs.com";
  const proxyUrl = clean(body.proxyUrl);
  const model = clean(body.model) || "wanx2.1-t2i-plus";
  const aspectRatio = clean(body.aspectRatio) || "16:9";
  const resolution = clean(body.resolution) || "2K";

  if (!apiKey) return NextResponse.json({ error: "Missing DashScope API Key." }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: "Missing image prompt." }, { status: 400 });
  if (!/^(wan|wanx)/i.test(model)) return NextResponse.json({ error: "Only wan/wanx image models are allowed on this channel." }, { status: 400 });
  if (!isHttpUrl(apiBaseUrl)) return NextResponse.json({ error: "Aliyun API Base must be an http/https URL." }, { status: 400 });
  if (proxyUrl && !isHttpUrl(proxyUrl)) return NextResponse.json({ error: "Proxy URL must be an http/https URL." }, { status: 400 });

  const endpoint = `${apiBaseUrl.replace(/\/+$/, "")}/api/v1/services/aigc/text2image/image-synthesis`;
  const payload = {
    model,
    input: { prompt: [prompt, "", `Aspect ratio: ${aspectRatio}.`, `Output quality: ${resolution}.`, "Use this channel mainly for clean backgrounds, classroom scenes, or illustrations; teaching text should preferably be overlaid as editable PPT text."].join("\n") },
    parameters: { size: "1024*576", n: 1 },
  };
  const response = await fetch(endpoint, postJson(payload, { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-DashScope-Async": "enable" }, proxyUrl));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json({ error: `Aliyun Wanx returned ${response.status}: ${errorMessage(data, response.statusText)}` }, { status: response.status });
  const output = ((data as Record<string, unknown>).output || {}) as Record<string, unknown>;
  const taskId = clean(output.task_id) || clean(output.taskId);
  if (!taskId) return NextResponse.json({ error: "Aliyun Wanx did not return task_id." }, { status: 502 });
  try {
    const url = await pollAliyun(taskId, apiBaseUrl, apiKey, proxyUrl);
    return NextResponse.json({ provider: "aliyun", model, ...(await downloadImage(url, proxyUrl)), taskId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error", taskId }, { status: 502 });
  }
}

function dmxImageEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/images/generations")) return base;
  if (base.endsWith("/v1")) return `${base}/images/generations`;
  return `${base}/v1/images/generations`;
}

function dmxResponsesEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/responses")) return base;
  if (base.endsWith("/v1")) return `${base}/responses`;
  return `${base}/v1/responses`;
}

async function dmxapiImage(body: ImageRequest) {
  const prompt = clean(body.prompt);
  const apiKey = clean(body.apiKey) || process.env.DMXAPI_API_KEY || process.env.DMXAPI_IMAGE_API_KEY || "";
  const apiBaseUrl = clean(body.apiBaseUrl) || process.env.DMXAPI_BASE_URL || "https://www.dmxapi.cn/v1";
  const proxyUrl = clean(body.proxyUrl);
  const rawModel = clean(body.model);
  const model = rawModel === "qwen-image" || rawModel === "wan2.5-t2i-preview" ? "wan2.7-image" : rawModel || "gpt-image-2";
  const aspectRatio = clean(body.aspectRatio) || "16:9";
  const resolution = clean(body.resolution) || "2K";

  if (!apiKey) return NextResponse.json({ error: "Missing DMXAPI API Key." }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: "Missing image prompt." }, { status: 400 });
  if (!isHttpUrl(apiBaseUrl)) return NextResponse.json({ error: "DMXAPI Base URL must be an http/https URL." }, { status: 400 });
  if (proxyUrl && !isHttpUrl(proxyUrl)) return NextResponse.json({ error: "Proxy URL must be an http/https URL." }, { status: 400 });

  if (model === "wan2.7-image") {
    const size = ((ratio: string, quality: string) => {
      const is1k = quality === "1K";
      const sizes: Record<string, string> = {
        "1:1": is1k ? "1024*1024" : "2048*2048",
        "16:9": is1k ? "1024*576" : "2048*1152",
        "4:3": is1k ? "1024*768" : "1792*1344",
        "3:4": is1k ? "768*1024" : "1344*1792",
        "9:16": is1k ? "576*1024" : "1152*2048",
      };
      return sizes[ratio] || (is1k ? "1K" : "2K");
    })(aspectRatio, resolution);
    const endpoint = dmxResponsesEndpoint(apiBaseUrl);
    const payload = {
      model,
      input: { messages: [{ role: "user", content: [{ text: [prompt, "", `Aspect ratio: ${aspectRatio}.`, `Output size: ${size}.`, "For primary-school English teaching slides, prioritize clear Chinese/English text, correct spelling, and projector readability."].join("\n") }] }] },
      parameters: { enable_sequential: false, size, n: 1, watermark: false, thinking_mode: true },
    };
    const response = await fetch(endpoint, postJson(payload, { "Content-Type": "application/json", Accept: "application/json", Authorization: apiKey }, proxyUrl));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: `DMXAPI wan2.7-image returned ${response.status}: ${errorMessage(data, response.statusText)}` }, { status: response.status });
    const output = Array.isArray((data as Record<string, unknown>).output) ? ((data as Record<string, unknown>).output as Array<Record<string, unknown>>) : [];
    let imageUrl = clean((data as Record<string, unknown>).url) || clean((data as Record<string, unknown>).image_url);
    for (const item of output) {
      const content = Array.isArray(item.content) ? (item.content as Array<Record<string, unknown>>) : [];
      const image = content.find((part) => part.type === "image" && typeof part.text === "string");
      if (image) imageUrl = clean(image.text);
      if (imageUrl) break;
    }
    if (imageUrl) return NextResponse.json({ provider: "dmxapi", model, ...(await downloadImage(imageUrl, proxyUrl)), requestId: clean((data as Record<string, unknown>).request_id) || null });
    return NextResponse.json({ error: "DMXAPI wan2.7-image did not return an image URL." }, { status: 502 });
  }

  const size = ({ "1:1": "1024x1024", "16:9": "1536x1024", "4:3": "1536x1024", "3:4": "1024x1536", "9:16": "1024x1536" } as Record<string, string>)[aspectRatio] || "auto";
  const endpoint = dmxImageEndpoint(apiBaseUrl);
  const payload = {
    model,
    prompt: [prompt, "", `Aspect ratio: ${aspectRatio}.`, `Output quality: ${resolution}.`, "For primary-school English teaching slides, prioritize clear Chinese/English text, correct spelling, and projector readability."].join("\n"),
    n: 1,
    size,
    response_format: "b64_json",
  };
  const response = await fetch(endpoint, postJson(payload, { "Content-Type": "application/json", Accept: "application/json", Authorization: apiKey }, proxyUrl));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json({ error: `DMXAPI image generation returned ${response.status}: ${errorMessage(data, response.statusText)}` }, { status: response.status });
  const items = Array.isArray((data as Record<string, unknown>).data) ? ((data as Record<string, unknown>).data as Array<Record<string, unknown>>) : [];
  for (const item of items) {
    if (typeof item.b64_json === "string") return NextResponse.json({ provider: "dmxapi", model, mimeType: clean(item.mime_type) || clean(item.mimeType) || "image/png", imageBase64: item.b64_json });
    if (typeof item.url === "string") return NextResponse.json({ provider: "dmxapi", model, ...(await downloadImage(item.url, proxyUrl)) });
  }
  const url = clean((data as Record<string, unknown>).url) || clean((data as Record<string, unknown>).image_url);
  if (url) return NextResponse.json({ provider: "dmxapi", model, ...(await downloadImage(url, proxyUrl)) });
  return NextResponse.json({ error: "DMXAPI image generation did not return image data." }, { status: 502 });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ImageRequest;
    const provider = normalizeProvider(body.provider);
    if (provider === "google") return googleImage(body);
    if (provider === "volcengine") return volcengineImage(body);
    if (provider === "zhipu") return zhipuImage(body);
    if (provider === "aliyun") return aliyunImage(body);
    if (provider === "dmxapi") return dmxapiImage(body);
    return NextResponse.json({ error: "Unsupported image provider." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Image generation API error: ${message}` }, { status: 500 });
  }
}
