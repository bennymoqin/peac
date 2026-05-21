import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";
import type { RequestInit } from "node-fetch";
import { defaultSubjectPrompt, defaultTeachingSystemPrompt } from "@/lib/prompt-presets";

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
};

export type ModelSettings = {
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  proxyUrl?: string;
  reasoningEffort?: string;
};

type DomesticModelPayload = {
  model: string;
  messages: Array<{ role: "user"; content: string }>;
  temperature: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  thinking?: { type: "disabled" };
  reasoning_effort?: string;
};

type DomesticModelResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

class DomesticModelRequestError extends Error {
  status: number;
  endpoint: string;
  isHtmlResponse: boolean;

  constructor(message: string, status: number, endpoint: string, isHtmlResponse = false) {
    super(message);
    this.name = "DomesticModelRequestError";
    this.status = status;
    this.endpoint = endpoint;
    this.isHtmlResponse = isHtmlResponse;
  }
}

function cleanOptionalValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clipText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n【内容过长，已截断用于本次模型调用】`;
}

function getDomesticTemperature(modelName: string, baseUrl: string) {
  const normalizedModel = modelName.toLowerCase();
  const normalizedBaseUrl = baseUrl.toLowerCase();

  if (normalizedModel.includes("kimi-k2.6")) {
    return 0.6;
  }

  if (normalizedModel.includes("kimi") || normalizedBaseUrl.includes("moonshot.cn")) {
    return 1;
  }

  return 0.4;
}

function isKimiModel(modelName: string, baseUrl: string) {
  return modelName.toLowerCase().includes("kimi") || baseUrl.toLowerCase().includes("moonshot.cn");
}

function isDeepSeekV4Model(modelName: string, baseUrl: string) {
  const normalizedModel = modelName.toLowerCase();
  const normalizedBaseUrl = baseUrl.toLowerCase();
  return normalizedModel.startsWith("deepseek-v4-") || normalizedBaseUrl.includes("api.deepseek.com");
}

function isDmxApiEndpoint(baseUrl: string) {
  return baseUrl.toLowerCase().includes("dmxapi.cn");
}

function normalizeDomesticEndpoint(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");

  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/chat/completions`;
  }

  return trimmed;
}

function parseGroupJsonLoosely(text: string, group: string) {
  const raw = text.trim();
  const attempts = [
    raw,
    raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim(),
  ];
  const firstObjectStart = raw.indexOf("{");
  const lastObjectEnd = raw.lastIndexOf("}");
  if (firstObjectStart >= 0 && lastObjectEnd > firstObjectStart) {
    attempts.push(raw.slice(firstObjectStart, lastObjectEnd + 1));
  }

  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as {
        title?: unknown;
        summary?: unknown;
        items?: unknown;
        detail?: unknown;
      };
      const items = Array.isArray(parsed.items)
        ? parsed.items.map((item) => String(item)).filter(Boolean).slice(0, 8)
        : [];
      return {
        title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : `${group}输出`,
        summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "已生成本组内容。",
        items: items.length ? items : ["已生成结构化内容，请查看完整详情。"],
        detail: typeof parsed.detail === "string" && parsed.detail.trim() ? parsed.detail.trim() : raw,
      };
    } catch {
      // Try the next shape.
    }
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    title: `${group}输出`,
    summary: lines[0] || "模型返回了非 JSON 文本，已自动整理为可继续流转的结构。",
    items: lines.slice(0, 6).length ? lines.slice(0, 6) : ["请查看完整详情。"],
    detail: raw || "暂无内容。",
  };
}

function resolveSystemPrompt(systemPromptOverride?: string, subjectPromptOverride?: string) {
  const basePrompt = cleanOptionalValue(systemPromptOverride) || defaultTeachingSystemPrompt;
  const subjectPrompt = cleanOptionalValue(subjectPromptOverride) || defaultSubjectPrompt;

  return [
    basePrompt,
    "",
    "【小学英语补充 Prompt】",
    "以下 Prompt 只用于补充本校小学英语教研规则；如它与默认规则冲突，以用户最新任务输入和小学英语科组定位为准。",
    subjectPrompt,
  ].join("\n");
}

function resolveGroupSystemPrompt(systemPromptOverride?: string, subjectPromptOverride?: string) {
  const customSystemPrompt = cleanOptionalValue(systemPromptOverride);
  const customSubjectPrompt = cleanOptionalValue(subjectPromptOverride);
  const hasCustomSystem = Boolean(customSystemPrompt && customSystemPrompt !== defaultTeachingSystemPrompt);
  const hasCustomSubject = Boolean(customSubjectPrompt && customSubjectPrompt !== defaultSubjectPrompt);

  return [
    "【统一教研规则摘要】",
    "- 面向 1-6 年级小学英语教师，必须服从用户填写的教材版本、年级、册别、Unit / Module、课时主题和课时类型。",
    "- 默认同一课题、同一核心目标、单班分层推进；不得输出一班/四班或不同班级版本。",
    "- 输出要可落地、可检测、可编辑，避免空泛口号。",
    "- 若引用资料与当前课题冲突，只能参考格式，不能替换当前课题内容。",
    hasCustomSystem ? `\n【用户自定义系统规则摘要】\n${clipText(customSystemPrompt || "", 1600)}` : "",
    hasCustomSubject ? `\n【用户自定义学科规则摘要】\n${clipText(customSubjectPrompt || "", 1200)}` : "",
  ].filter(Boolean).join("\n");
}

function groupMaxTokens(group: string) {
  if (group === "学情分析组") return 2200;
  if (group === "集体备课组") return 2600;
  if (group === "详细教案组") return 4200;
  if (group === "检测作业组") return 4200;
  if (group === "PPT脚本组") return 3800;
  return 3200;
}

const finalTeachingPlanTemplate = `
【最终教学设计成品模板（必须严格按照此模板的长度、详细程度和颗粒度输出）】

## 模块一：教学基本信息

必须包含：
- 课题；
- 课型；
- 单元大观念（Big Idea），需同时给出英文表达和中文解释；
- 本课子话题；
- 教学目标，至少分为语言知识目标、语言技能目标、思维品质目标、文化意识目标；如果不是英语学科，应替换为该学科对应的知识技能、方法过程、思维素养、价值观目标；
- 教学重难点及易错提醒；
- 重点、难点、易错提醒必须写到具体知识点和学生常见错误，不得只写抽象表述。

示例粒度：
- 课题：PEP 五年级下册 Unit 2 My favourite season Read and write
- 课型：词汇语用课 / 大单元第3课时中的“经历补充与分享”子课时
- 单元大观念：A trip is not only about where you went, but also what you did, what you felt and what you shared.
- 本课子话题：Sharing sweet holiday memories

## 模块二：30分钟授课流程设计

必须按 4 个 Step 输出，每一步都要包含目标、设计、教师提示语、板书建议或操作建议。

推荐结构：

### Step 1: 导入热身 (Warm-up) — 5分钟
- 目标；
- 设计；
- 教师提示语；
- 板书建议。

### Step 2: 知识呈现 (Presentation) — 10分钟
- 目标；
- 情境导入；
- 新授内容，需逐条展开；
- 归类或结构化梳理；
- 句型/方法/概念带入；
- 微评价。

### Step 3: 趣味操练 (Practice) — 8分钟
- 目标；
- 至少 2-3 个活动；
- 每个活动写清时间、学生做什么、教师怎么组织；
- 分层要求：基础生、中等生、拔高生分别做什么。

### Step 4: 语境输出 (Production) — 7分钟
- 目标；
- 任务名称；
- 模板或支架；
- 学生输出范例；
- 展示方式；
- 评价标准。

## 模块三：10分钟分层随堂检测（附教师解析）

必须包含 A/B/C 三层。

### A层（必做基础题）
- 至少 3 题；
- 每题必须包含题干、答案、解析、易错点。

### B层（提高运用题）
- 至少 3 题；
- 每题必须包含题干、答案或参考答案、解析、易错点。

### C层（挑战拓展题）
- 至少 1 题；
- 优先采用信息卡、表格、图文材料、情境任务、非连续性文本或综合运用题；
- 必须包含参考答案、解析、易错点。

检测题必须能真实用于 10 分钟课堂小测，不得只写题型名称。

## 模块四：PPT 页码大纲

这里只输出 10-15 页 PPT 的页码规划，不生成完整逐页脚本。每页只写：
- 页码；
- 页面主题；
- 核心展示内容关键词；
- 对应教学环节。

PPT 页码大纲需覆盖：
- 封面；
- 单元情境链或本课任务；
- 热身复习；
- 新课导入；
- 核心知识呈现；
- 句型/方法操练；
- 趣味练习；
- 语境输出；
- A层检测；
- B/C层检测；
- 小测答案与总结；
- 课后延伸。

完整逐页 PPT 脚本由后续「PPT脚本组」单独生成，本模块不得展开排版样式、页面完整文案或逐页详稿。

## 模块五：可直接上课用的补充建议

必须包含：
1. 本课与大单元的衔接话术；
2. 板书推荐；
3. 课后分层作业；
4. 教师上课逐环节口令建议，可简要但必须具体。

【强制要求】
- 最终教学设计的详细程度必须接近用户提供的模板，不得压缩成概要；
- 每个模块都要有可直接复制上课使用的内容；
- 必须根据用户选择的年级自动适配小学英语课堂：低年级重听说体验和图片/TPR 支持，中年级重词句操练与对话表演，高年级重语篇阅读、写作支架和综合语用。
`.trim();

async function callDomesticModel(prompt: string, isJson: boolean, settings: ModelSettings = {}, maxTokens?: number) {
  const apiKey = cleanOptionalValue(settings.apiKey) || process.env.DOMESTIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "未配置国内大模型 API Key。请在页面模型配置中填写密钥，或在 peac/.env.local 中设置 DOMESTIC_API_KEY 后重启服务。"
    );
  }

  const baseUrl =
    cleanOptionalValue(settings.baseUrl) ||
    process.env.DOMESTIC_BASE_URL ||
    "https://api.moonshot.cn/v1";
  const endpoint = normalizeDomesticEndpoint(baseUrl);
  const modelName =
    cleanOptionalValue(settings.modelName) ||
    process.env.DOMESTIC_MODEL_NAME ||
    "kimi-k2.6";

  const payload: DomesticModelPayload = {
    model: modelName,
    messages: [{ role: "user", content: prompt }],
    temperature: getDomesticTemperature(modelName, baseUrl),
  };

  if (maxTokens) {
    payload.max_tokens = maxTokens;
  }

  if (isJson) {
    payload.response_format = { type: "json_object" };
  }

  const reasoningEffort = cleanOptionalValue(modelSettings.reasoningEffort)?.toLowerCase();
  if (isDmxApiEndpoint(baseUrl) && reasoningEffort && ["low", "medium", "high", "xhigh"].includes(reasoningEffort)) {
    payload.reasoning_effort = reasoningEffort;
  }

  if (isKimiModel(modelName, baseUrl) || isDeepSeekV4Model(modelName, baseUrl)) {
    payload.thinking = { type: "disabled" };
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: isDmxApiEndpoint(baseUrl) ? apiKey : `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await res.text();
  let data: DomesticModelResponse;

  try {
    data = JSON.parse(rawText) as DomesticModelResponse;
  } catch {
    const preview = rawText.slice(0, 160).replace(/\s+/g, " ").trim();

    if (preview.startsWith("<")) {
      throw new DomesticModelRequestError(
        `国内大模型接口返回了 HTML 页面而不是 JSON（HTTP ${res.status}）。请检查接口地址是否正确，或稍后重试。当前地址：${endpoint}`,
        res.status,
        endpoint,
        true,
      );
    }

    throw new DomesticModelRequestError(
      `国内大模型接口返回了无法解析的响应（HTTP ${res.status}）。当前地址：${endpoint}。响应片段：${preview || "空响应"}`,
      res.status,
      endpoint,
    );
  }

  if (!res.ok) {
    throw new DomesticModelRequestError(
      data?.error?.message || `国内大模型请求失败（HTTP ${res.status}）`,
      res.status,
      endpoint,
    );
  }

  let text = data?.choices?.[0]?.message?.content?.trim() || "";
  
  if (isJson) {
    text = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  }
  
  return text;
}

export async function generateTeachingResearchMarkdown(input: string, context: string = "", modelType: string = "domestic", knowledgeBaseText: string = "", modelSettings: ModelSettings = {}, systemPromptOverride?: string, subjectPromptOverride?: string) {
  const prompt = [
    "你是「小学英语智能备课教研协作中心 v1（新课标教师版）」的总控汇总助手。",
    "请基于用户提供的教研任务与各组产出，输出完整教研模式的两个最终交付物。",
    resolveSystemPrompt(systemPromptOverride, subjectPromptOverride),
    knowledgeBaseText ? `\n【全局教研参考资料（请严格遵循以下资料的规范与内容进行汇总）：】\n${knowledgeBaseText}\n` : "",
    context ? `\n【各组教研产出参考（请基于此汇总）】\n${context}\n` : "",
    "输出要求：",
    "- 只输出 Markdown，不要输出多余说明",
    "- 语言：中文",
    "- 只包含以下两个一级标题：",
    "  1) 教学设计",
    "  2) PPT 脚本",
    "- 教学设计必须体现：教学主线、单班分层推进、30分钟授课流程、10分钟分层检测、课后分层作业",
    finalTeachingPlanTemplate,
    "- 教学设计必须严格按照上方【最终教学设计成品模板】输出，不得只给概要",
    "- 教学设计中的 10 分钟检测必须写出 A/B/C 层设计及答案解析",
    "- 教学设计中只保留 PPT 页码大纲，不生成完整逐页 PPT 脚本",
    "- 如需 PPT 脚本，只在第二个一级标题中生成：10-15 页逐页内容，每页只包含【页面文字内容】和【排版样式与时间建议】",
    "- PPT 脚本不得输出一班使用建议、四班使用建议、不同班级使用建议、教师操作建议、学生任务说明",
    "- 教学设计中的课后作业必须写出基础巩固、提高训练、拓展迁移与低分学生追踪建议",
    "- 内容务实、可落地，避免空泛口号",
    "",
    "教研任务：",
    input.trim(),
  ].join("\n");

  if (modelType === "domestic") {
    return await callDomesticModel(prompt, false, modelSettings);
  }

  const apiKey = cleanOptionalValue(modelSettings.apiKey) || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "未配置 Gemini API Key。请在页面模型配置中填写密钥，或在 peac/.env.local 中设置 GEMINI_API_KEY 后重启服务。"
    );
  }
  const proxyUrl =
    cleanOptionalValue(modelSettings.proxyUrl) ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy;
  const modelName = cleanOptionalValue(modelSettings.modelName) || "gemini-3-flash-preview";
  
    const fetchOptions: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          topP: 0.9,
          maxOutputTokens: 8192,
        },
      }),
    };

  if (proxyUrl) {
    fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, fetchOptions);
  const data = (await res.json()) as GeminiGenerateContentResponse;

  if (!res.ok) {
    const message = data?.error?.message || `Gemini 请求失败（HTTP ${res.status}）`;
    throw new Error(message);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    throw new Error("Gemini 返回为空：未获得可用的文本内容。");
  }

  return text;
}

export async function generateGroupOutput(input: string, group: string, context: string = "", modelType: string = "domestic", knowledgeBaseText: string = "", modelSettings: ModelSettings = {}, systemPromptOverride?: string, subjectPromptOverride?: string) {
  let roleDescription = `你是「小学英语智能备课教研协作中心 v1（新课标教师版）」的「${group}」专家。`;
  let taskDescription = "请基于用户提供的教研任务，输出该组的教研产出核心要点。";

  const lessonSkeletonReference = `
【轻量教学设计骨架输出范围】
只输出供教师快速确认的教学设计骨架，必须短而完整，禁止展开成长教案。

detail 必须包含以下 5 个模块：
## 一、教学目标
- 语言知识目标；
- 语言技能目标；
- 思维品质 / 文化意识目标；
- 可观察、可检测的课堂产出。

## 二、重难点与易错提醒
- 重点；
- 难点；
- 易错点；
- 分层支持方向。

## 三、4 个 Step 活动链
只写每个 Step 的目标、活动名称、学生任务和预计时间。
必须覆盖：
- Step 1 导入热身；
- Step 2 知识呈现；
- Step 3 趣味操练；
- Step 4 语境输出。

## 四、检测题型框架
只写 A/B/C 三层检测的题型、考查点和题量，不写完整题目、答案、解析。

## 五、PPT 页码大纲
只写 10-15 页页码、页面主题、核心内容关键词、对应教学环节。

禁止输出：
- 完整 A/B/C 检测题、答案和解析；
- 完整逐页 PPT 脚本；
- 超长教师逐环节口令；
- 独立课后辅导小组内容。
`;

  // 定义统一的教学设计参考模板，供需要产出详细教案的节点使用
  const templateReference = `
${finalTeachingPlanTemplate}

【中间节点输出提醒】
由于本接口要求 JSON，请把摘要和完整内容分别放入不同字段。
items 用于卡片摘要，detail 用于承载完整 Markdown 内容。
items 至少覆盖：
- 模块一：教学基本信息；
- 模块二：30分钟授课流程；
- 模块三：10分钟分层随堂检测；
- 基础薄弱学生补救安排；
- 中等学生提升任务；
- 学有余力学生挑战任务；
- 课后分层作业或后续追踪建议。
detail 必须按照模板写出完整内容，不能只写模块名称。
`;

  const lessonDetailReference = `
【详细教案组输出范围】
请基于教师确认后的【教学设计骨架】补全可上课教案，只负责以下内容：
- 教学基本信息；
- 30 分钟授课流程；
- 每个 Step 的教师提示语、学生任务、板书建议、分层支持；
- 本课与大单元的衔接话术；
- 板书推荐。

建议控制在 1800-2600 字，优先保证步骤清楚、教师能直接上课，不要扩写成公开课长稿。
不得生成完整 PPT 脚本。
不得生成完整 A/B/C 检测题、答案解析或课后作业；这些交给「检测作业组」。
detail 中必须是完整 Markdown 教案。
`;

  const assessmentReference = `
【检测作业组输出范围】
请基于教师确认后的【教学设计骨架】生成检测与作业，只负责以下内容：
## 一、10分钟分层随堂检测（附答案解析）
- A层基础题：至少 3 题，每题含题干、答案、解析、易错点；
- B层提高题：至少 3 题，每题含题干、参考答案、解析、易错点；
- C层挑战题：至少 1 题，优先采用信息卡、表格、图文材料、情境任务、非连续性文本或综合运用题，并含参考答案、解析、易错点。

## 二、课后分层作业
- 基础巩固；
- 提高训练；
- 拓展迁移；
- 低分学生追踪建议。

建议控制在 1800-2600 字；每题解析要具体但简明，避免重复解释。
不得生成完整教案流程，不得生成 PPT 脚本。
`;

  const pptTemplateReference = `
【PPT脚本参考范例格式（请严格参照此结构与粒度输出，生成 10-15 页的逐页脚本）】：
## Slide X: [页面主题，如：封面导入 / 新课导入 / 核心词组呈现]
- **【页面文字内容】**：
  [需要展示在 PPT 上的具体文字，包含主标题、副标题、核心句型、题目等]
- **【排版样式与时间建议】**：
  [本页建议用时、文字与图片布局、重点词句突出方式、页面视觉风格，以及适合导入/讲解/操练/输出/检测的用途]

禁止输出：
- 【教师操作建议】
- 【学生任务说明】
- 【一班使用建议】
- 【四班使用建议】
- 【不同班级使用建议】

只基于压缩后的教学目标、4 个 Step 活动链、核心词句/语篇材料和 PPT 页码大纲生成。不要复述完整教案，不要生成检测题解析或课后作业。
建议生成 10-12 页；每页【页面文字内容】不超过 80 字，【排版样式与时间建议】不超过 80 字。
`;

  if (group === "集体备课组") {
    taskDescription = "请基于【学情分析组】的结论，只输出可供教师快速确认的轻量教学设计骨架。必须包含教学目标、重难点、4 个 Step 活动链、检测题型框架、PPT 页码大纲；不得生成完整教案、完整检测题解析或完整 PPT 脚本。";
  } else if (group === "详细教案组") {
    taskDescription = "请严格基于教师确认后的【教学设计骨架】，补全可直接上课使用的详细教案。只负责 30 分钟流程、教师话术、板书建议和分层支持，不生成完整检测作业或 PPT 脚本。";
  } else if (group === "检测作业组") {
    taskDescription = "请严格基于教师确认后的【教学设计骨架】，生成 10 分钟 A/B/C 分层随堂检测、答案解析、易错点和课后分层作业。不得生成完整教案或 PPT 脚本。";
  } else if (group === "修订备课组(二版教案)") {
    roleDescription = "你是「小学英语智能备课教研协作中心 v1」的「修订备课组」专家。";
    taskDescription = "请严格基于前置环节中的【初版教学设计】和【评课反馈建议】，吸收改进意见，输出一份迭代后的【V2.0 终版教学设计】。请务必参考下方提供的【教学设计参考范例格式】，确保结构完整。";
  } else if (group === "PPT脚本组") {
    taskDescription = "请严格基于压缩后的教学设计骨架与 PPT 页码大纲，生成逐页的 PPT 设计脚本。请务必参考下方提供的【PPT脚本参考范例格式】进行输出，不要读取或复述完整教案全文。";
  }

  const prompt = [
    roleDescription,
    taskDescription,
    resolveGroupSystemPrompt(systemPromptOverride, subjectPromptOverride),
    knowledgeBaseText ? `\n【全局教研参考资料（请严格参照此参考资料内的规范与内容进行设计）：】\n${clipText(knowledgeBaseText, group === "PPT脚本组" ? 1600 : 5200)}\n` : "",
    group === "集体备课组" ? lessonSkeletonReference : "",
    group === "修订备课组(二版教案)" ? templateReference : "",
    group === "详细教案组" ? lessonDetailReference : "",
    group === "检测作业组" ? assessmentReference : "",
    (group === "PPT脚本组") ? pptTemplateReference : "",
    context ? `\n【前置环节的输出参考（作为本次生成的上下文）】\n${clipText(context, group === "PPT脚本组" ? 3000 : 6000)}\n` : "",
    "输出要求：",
    "- 必须输出严格的 JSON 格式数据",
    "- 必须严格服从用户任务中的教材版本、年级、册别、Unit / Module 和课时主题；参考资料若出现其他单元内容，只能作为格式参考，不能替换本课内容",
    "- JSON 结构如下：",
    "  {",
    '    "title": "该组的输出标题（简明扼要）",',
    '    "summary": "该组的输出摘要（一两句话概括核心）",',
    '    "items": ["摘要要点1", "摘要要点2", "摘要要点3"],',
    '    "detail": "完整 Markdown 内容。教学设计相关节点必须在这里写出模块的具体内容，不能只写模块名称。"',
    "  }",
    "- items 中只放 3-6 条摘要要点，不能只列模块名称",
    "- detail 中必须写完整内容，但要严格遵守当前组别的输出范围",
    "- 如果是集体备课组，detail 只输出轻量教学设计骨架，不得展开成长教案",
    "- 如果是详细教案组，detail 必须体现班内分层推进，不得出现一班/四班两套方案",
    "- 如果是检测作业组，detail 必须聚焦随堂检测、答案解析和课后分层作业",
    "- 如果是 PPT 脚本组，detail 里必须体现逐页脚本，且每页只保留【页面文字内容】和【排版样式与时间建议】",
    "- 不得输出一班使用建议、四班使用建议、不同班级使用建议",
    "",
    "教研任务：",
    input.trim(),
  ].join("\n");

  const compactPrompt = [
    roleDescription,
    "当前模型供应商可能对长请求不稳定。请用较短但完整的 JSON 产出本节点内容。",
    "必须严格遵守当前组别职责：集体备课组只给骨架；详细教案组只补教案；检测作业组只写检测与作业；PPT脚本组只写逐页脚本。",
    knowledgeBaseText ? `\n【参考资料摘要】\n${clipText(knowledgeBaseText, 4000)}\n` : "",
    context ? `\n【前置输出摘要】\n${clipText(context, 4000)}\n` : "",
    "JSON 结构必须为：",
    '{"title":"标题","summary":"摘要","items":["3-6条摘要要点"],"detail":"完整 Markdown 内容。严格遵守当前组别职责。"}',
    "detail 不要只列模块名，必须写出具体内容，但不得跨组生成重复内容。",
    "教研任务：",
    input.trim(),
  ].join("\n");

  if (modelType === "domestic") {
    let text: string;
    const maxTokens = groupMaxTokens(group);
    try {
      text = await callDomesticModel(prompt, true, modelSettings, maxTokens);
    } catch (error) {
      const shouldRetry =
        error instanceof DomesticModelRequestError &&
        error.isHtmlResponse &&
        error.status >= 500;

      if (!shouldRetry) {
        throw error;
      }

      text = await callDomesticModel(compactPrompt, true, modelSettings, Math.min(maxTokens, 3000));
    }

    return parseGroupJsonLoosely(text, group);
  }

  const apiKey = cleanOptionalValue(modelSettings.apiKey) || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "未配置 Gemini API Key。请在页面模型配置中填写密钥，或在 peac/.env.local 中设置 GEMINI_API_KEY 后重启服务。"
    );
  }
  const proxyUrl =
    cleanOptionalValue(modelSettings.proxyUrl) ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy;
  const modelName = cleanOptionalValue(modelSettings.modelName) || "gemini-3-flash-preview";
  
  const fetchOptions: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          topP: 0.9,
          maxOutputTokens: groupMaxTokens(group),
          responseMimeType: "application/json",
        },
      }),
    };

  if (proxyUrl) {
    fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, fetchOptions);
  const data = (await res.json()) as GeminiGenerateContentResponse;

  if (!res.ok) {
    const message = data?.error?.message || `Gemini 请求失败（HTTP ${res.status}）`;
    throw new Error(message);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    throw new Error("Gemini 返回为空：未获得可用的文本内容。");
  }

  try {
    return parseGroupJsonLoosely(text, group);
  } catch {
    throw new Error("解析 JSON 失败：" + text);
  }
}

