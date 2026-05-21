"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  Download,
  FileText,
  GraduationCap,
  Package,
  Sparkles,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { defaultSubjectPrompt, defaultTeachingSystemPrompt } from "@/lib/prompt-presets";

type ResultView = "lesson" | "ppt" | "test" | "homework";

type ModelConfig = {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  proxyUrl: string;
};

function stripApiKeysFromModelConfigs(configs: Record<string, ModelConfig>) {
  return Object.fromEntries(
    Object.entries(configs).map(([key, config]) => [key, { ...config, apiKey: "" }]),
  ) as Record<string, ModelConfig>;
}

export default function Home() {
  type KnowledgeFile = {
    id: string;
    name: string;
    category: KnowledgeCategory;
    metadata: KnowledgeMetadata;
    summary: string;
    chunks: KnowledgeChunk[];
    content: string;
    createdAt: string;
    selected: boolean;
    uploading?: boolean;
  };

  type KnowledgeCategory = string;

  type SubjectProfileKey = "english";

  type TextbookVersion = "PEP" | "外研版" | "冀教版" | "译林版" | "沪教版" | "自定义";

  type Semester = "上册" | "下册";

  type SubjectProfile = {
    name: string;
    categories: Array<{ value: KnowledgeCategory; hint: string }>;
  };

  type KnowledgeMetadata = {
    subject: string;
    grade: string;
    unit: string;
    lessonType: string;
    tags: string[];
  };

  type KnowledgeChunk = {
    id: string;
    index: number;
    text: string;
    summary: string;
    keywords: string[];
  };

  const knowledgeDbName = "peac-knowledge-base";
  const knowledgeStoreName = "files";
  const subjectProfiles: Record<SubjectProfileKey, SubjectProfile> = {
    english: {
      name: "小学英语",
      categories: [
        { value: "教材课标", hint: "教材页、课标摘录、教辅知识清单" },
        { value: "词句语篇", hint: "核心词汇、句型、对话、阅读材料" },
        { value: "错题检测", hint: "错题记录、作业讲评、阶段检测" },
        { value: "班情反馈", hint: "成绩、课堂表现、学生分层记录" },
        { value: "学校模板", hint: "教案模板、公开课格式、作业单格式" },
      ],
    },
  };

  const gradeOptions = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"];
  const textbookOptions: TextbookVersion[] = ["PEP", "外研版", "冀教版", "译林版", "沪教版", "自定义"];
  const semesterOptions: Semester[] = ["上册", "下册"];

  const defaultModelConfig: Record<string, ModelConfig> = {
    gemini: {
      apiKey: "",
      baseUrl: "",
      modelName: "gemini-3-flash-preview",
      proxyUrl: "",
    },
    domestic: {
      apiKey: "",
      baseUrl: "https://api.moonshot.cn/v1",
      modelName: "kimi-k2.6",
      proxyUrl: "",
    },
  };

  const workflow = useMemo(
    () => [
      "总控协调组",
      "学情分析组",
      "集体备课组",
      "人工确认教案",
      "资源并行生成",
      "总控汇总",
    ],
    [],
  );

  const [currentWorkflowStep, setCurrentWorkflowStep] = useState<string>("");
  const [modelType, setModelType] = useState<string>("domestic");
  const [modelConfigs, setModelConfigs] = useState<Record<string, ModelConfig>>(defaultModelConfig);
  const [showExperimentalModels, setShowExperimentalModels] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [textbookVersion, setTextbookVersion] = useState<TextbookVersion>("PEP");
  const [customTextbookVersion, setCustomTextbookVersion] = useState("");
  const [gradeLevel, setGradeLevel] = useState("五年级");
  const [semester, setSemester] = useState<Semester>("下册");
  const [unitLabel, setUnitLabel] = useState("Unit 2");
  const [lessonTitle, setLessonTitle] = useState("My favourite season Read and write");
  const [lessonType, setLessonType] = useState("阅读课");
  const [taskInput, setTaskInput] = useState(
    "请以“PEP 五年级下册 Unit 2 My favourite season Read and write”为例，生成一节 40 分钟阅读课的教案、PPT脚本、随堂检测和课后作业。",
  );
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [finalResult, setFinalResult] = useState<string>("");
  const [outputs, setOutputs] = useState<
    Array<{
      group: string;
      title: string;
      summary: string;
      items: string[];
      detail?: string;
      meta: { updatedAt: string; state: "已生成" | "待生成" | "生成中" | "生成失败" };
      isEditing?: boolean;
      isExpanded?: boolean;
    }>
  >([
    {
      group: "学情分析组",
      title: "小学英语学情与难点假设",
      summary: "结合所选年级特点、常见差异与课标要求，先给出可验证的学情画像与风险点。",
      items: [
        "教材语言：核心词句、语篇信息和课堂输出任务需要按年级降低或提升难度",
        "课堂活动：低年级重体验，中年级重操练，高年级重阅读写作与综合语用",
        "分层支持：基础薄弱学生需要可完成支架，学有余力学生需要挑战迁移",
      ],
      meta: { updatedAt: "刚刚", state: "已生成" },
      isExpanded: false,
    },
    {
      group: "集体备课组",
      title: "教学目标与流程草案",
      summary: "形成可落地的目标、重难点、活动链与评价点。",
      items: [
        "目标：围绕本课主题完成可观察、可检测的听说读写任务",
        "活动链：导入激活 → 语料输入 → 支架操练 → 分层输出 → 当堂检测",
        "评价：以“信息完整度 + 语言准确度 + 互动质量”三维量规记录",
      ],
      meta: { updatedAt: "2 分钟前", state: "已生成" },
      isExpanded: false,
    },
  ]);

  function buildFinalMarkdown(currentTask: string, records: typeof outputs) {
    const header = `# 备课材料预览\n\n**备课任务：** ${currentTask}\n\n---\n`;
    const visibleOutputs = records.filter((o) =>
      ["详细教案组", "检测作业组", "PPT脚本组"].includes(o.group),
    );
    const body = visibleOutputs.length
      ? visibleOutputs
          .map((o) => {
            const detail = o.detail?.trim() || o.items.map((x) => `- ${x}`).join("\n");
            return `## ${o.group}：${o.title}\n\n${o.summary}\n\n${detail}\n`;
          })
          .join("\n")
      : "等待生成教学设计与 PPT 脚本。";
    const footer =
      "\n---\n\n**当前交付物：**\n- 可上课教案\n- PPT 脚本\n- 随堂检测\n- 课后作业\n";
    return `${header}\n${body}${footer}`;
  }

  const finalMarkdown = buildFinalMarkdown(taskInput, outputs);

  const [isPausedForHuman, setIsPausedForHuman] = useState(false);
  const [accumulatedContext, setAccumulatedContext] = useState("");
  const [kbFiles, setKbFiles] = useState<KnowledgeFile[]>([]);
  const [isKnowledgeReady, setIsKnowledgeReady] = useState(false);
  const [subjectProfileKey] = useState<SubjectProfileKey>("english");
  const activeSubjectProfile = subjectProfiles[subjectProfileKey];
  const knowledgeCategories = activeSubjectProfile.categories.map((category) => category.value);
  const knowledgeCategoryHints = Object.fromEntries(
    activeSubjectProfile.categories.map((category) => [category.value, category.hint]),
  ) as Record<KnowledgeCategory, string>;
  const [uploadCategory, setUploadCategory] = useState<KnowledgeCategory>("教材课标");
  const [knowledgeCategoryFilter, setKnowledgeCategoryFilter] = useState<"全部" | KnowledgeCategory>("全部");
  const [uploadGrade, setUploadGrade] = useState(gradeLevel);
  const [uploadUnit, setUploadUnit] = useState(unitLabel);
  const [uploadTags, setUploadTags] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [systemPromptOverride, setSystemPromptOverride] = useState(defaultTeachingSystemPrompt);
  const [subjectPromptOverride, setSubjectPromptOverride] = useState(defaultSubjectPrompt);
  const [resultView, setResultView] = useState<ResultView>("lesson");
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const activeModelConfig = modelConfigs[modelType] || defaultModelConfig.gemini;
  const modelSettings = {
    apiKey: activeModelConfig.apiKey,
    baseUrl: modelType === "domestic" ? activeModelConfig.baseUrl : undefined,
    modelName: activeModelConfig.modelName,
    proxyUrl: modelType === "gemini" ? activeModelConfig.proxyUrl : undefined,
  };
  const selectedTextbookVersion =
    textbookVersion === "自定义"
      ? customTextbookVersion.trim() || "自定义教材"
      : textbookVersion;

  const structuredLessonName = [
    selectedTextbookVersion,
    gradeLevel,
    semester,
    unitLabel.trim(),
    lessonTitle.trim(),
  ]
    .filter(Boolean)
    .join(" ");
  const selectedKnowledgeFiles = kbFiles.filter((file) => file.selected && !file.uploading);
  const selectedKnowledgeChunks = retrieveKnowledgeChunks(
    selectedKnowledgeFiles,
    buildRetrievalQuery(),
    12,
  );
  const referencedKnowledgeFiles = useMemo(() => {
    const seen = new Set<string>();
    return selectedKnowledgeChunks
      .filter((item) => {
        if (seen.has(item.file.id)) return false;
        seen.add(item.file.id);
        return true;
      })
      .map((item) => item.file);
  }, [selectedKnowledgeChunks]);
  const visibleKnowledgeFiles =
    knowledgeCategoryFilter === "全部"
      ? kbFiles
      : kbFiles.filter((file) => file.category === knowledgeCategoryFilter);
  const previewMarkdown = finalResult || finalMarkdown;
  const workflowStepIndex = currentWorkflowStep ? workflow.indexOf(currentWorkflowStep) : -1;
  const completedWorkflowCount =
    workflowStepIndex >= 0 ? workflowStepIndex : finalResult ? workflow.length : 0;
  const workflowProgress =
    finalResult && !currentWorkflowStep
      ? 100
      : Math.round((completedWorkflowCount / Math.max(workflow.length, 1)) * 100);
  const secondsSinceLastActivity = lastActivityAt ? Math.max(0, Math.floor((Date.now() - lastActivityAt) / 1000)) : 0;
  const isWaitingLong = isRunning && secondsSinceLastActivity >= 90;

  const splitFinalDeliverables = useMemo(() => {
    const markdown = previewMarkdown.trim();
    const teachingTitleMatch = markdown.match(/^#{1,3}\s*教学设计\s*$/im);
    const pptTitleMatch = markdown.match(/^#{1,3}\s*PPT\s*脚本\s*$/im);

    const sectionFrom = (source: string, title: string, patterns: RegExp[]) => {
      const matches = patterns
        .map((pattern) => {
          const match = source.match(pattern);
          return match?.index === undefined ? null : { index: match.index, text: match[0] };
        })
        .filter((match): match is { index: number; text: string } => Boolean(match))
        .sort((a, b) => a.index - b.index);

      if (!matches.length) return `# ${title}\n\n暂无内容。`;

      const start = matches[0].index;
      const tail = source.slice(start);
      const nextHeading = tail.slice(matches[0].text.length).search(/\n#{1,3}\s+/);
      const content =
        nextHeading >= 0 ? tail.slice(0, matches[0].text.length + nextHeading).trim() : tail.trim();

      return content ? `# ${title}\n\n${content}` : `# ${title}\n\n暂无内容。`;
    };

    if (teachingTitleMatch?.index !== undefined && pptTitleMatch?.index !== undefined) {
      const firstStart = Math.min(teachingTitleMatch.index, pptTitleMatch.index);
      const secondStart = Math.max(teachingTitleMatch.index, pptTitleMatch.index);
      const teachingSection =
        teachingTitleMatch.index < pptTitleMatch.index
          ? markdown.slice(teachingTitleMatch.index, pptTitleMatch.index).trim()
          : markdown.slice(teachingTitleMatch.index).trim();
      const pptSection =
        pptTitleMatch.index > firstStart && pptTitleMatch.index === secondStart
          ? markdown.slice(pptTitleMatch.index).trim()
          : markdown.slice(pptTitleMatch.index, teachingTitleMatch.index).trim();
      const inClassTest = sectionFrom(teachingSection, "随堂检测", [/^#{1,3}\s*模块三[:：]?.*随堂检测.*$/im, /^#{1,3}\s*.*检测.*$/im]);
      const homework = sectionFrom(teachingSection, "课后作业", [/^#{1,3}\s*模块五[:：]?.*补充建议.*$/im, /^#{1,3}\s*.*课后.*$/im, /^#{1,3}\s*.*作业.*$/im]);

      return {
        teachingDesign: teachingSection || "# 可上课教案\n\n暂无内容。",
        pptScript: pptSection || "# PPT 脚本\n\n暂无内容。",
        assessment: [inClassTest, homework].join("\n\n"),
        inClassTest,
        homework,
      };
    }

    const firstLessonPlan =
      outputs.find((output) => output.group === "详细教案组") ||
      outputs.find((output) => output.group === "集体备课组");
    const pptOutput = outputs.find((output) => output.group === "PPT脚本组");
    const assessmentOutput = outputs.find((output) => output.group === "检测作业组");
    const lessonPlanOutput = firstLessonPlan;

    const formatOutputAsMarkdown = (title: string, output?: (typeof outputs)[number]) => {
      if (!output) return `# ${title}\n\n暂无内容。`;

      const detail = output.detail?.trim() || output.items.map((item) => `- ${item}`).join("\n");
      return [`# ${title}`, "", `## ${output.title}`, "", output.summary, "", detail].join("\n").trim();
    };

    const assessmentMarkdown = formatOutputAsMarkdown("检测与作业", assessmentOutput);

    return {
      teachingDesign: [
        formatOutputAsMarkdown("可上课教案", lessonPlanOutput),
      ].filter(Boolean).join("\n\n"),
      pptScript: formatOutputAsMarkdown("PPT 脚本", pptOutput),
      assessment: assessmentMarkdown,
      inClassTest: sectionFrom(assessmentMarkdown, "随堂检测", [/^#{1,3}\s*.*随堂检测.*$/im, /^#{1,3}\s*.*检测.*$/im]),
      homework: sectionFrom(assessmentMarkdown, "课后作业", [/^#{1,3}\s*.*课后.*$/im, /^#{1,3}\s*.*作业.*$/im]),
    };
  }, [outputs, previewMarkdown]);

  const activePreviewContent =
    resultView === "lesson"
      ? splitFinalDeliverables.teachingDesign
      : resultView === "ppt"
        ? splitFinalDeliverables.pptScript
        : resultView === "test"
          ? splitFinalDeliverables.inClassTest
          : splitFinalDeliverables.homework;

  const activeModelLabel =
    modelType === "gemini" ? activeModelConfig.modelName || "Gemini" : activeModelConfig.modelName || "国内模型";
  const firstLessonDraftIndex = outputs.findIndex((output) => output.group === "集体备课组");
  const firstLessonDraft = firstLessonDraftIndex >= 0 ? outputs[firstLessonDraftIndex] : undefined;
  const lessonTypeOptions = ["词汇课", "对话课", "阅读课", "语音课", "写作课", "复习课", "讲评课", "融合课"];
  const isFinalReady = Boolean(finalResult.trim());

  function buildTeacherPrompt() {
    return [
      "产品定位：小学英语智能备课教研协作中心 v1，面向 1-6 年级英语教师的一站式备课减负工具。",
      `教材版本：${selectedTextbookVersion}`,
      `年级：${gradeLevel}`,
      `册别：${semester}`,
      `Unit / Module：${unitLabel.trim() || "未填写"}`,
      `课时/主题：${lessonTitle.trim() || "未填写"}`,
      `课时类型：${lessonType}`,
      `硬性单元约束：本次只允许围绕 ${gradeLevel}${semester} ${unitLabel.trim() || "当前单元"} ${lessonTitle.trim() || "当前课题"} 设计；如果参考资料中出现其他 Unit / Module 的内容，只能作为格式参考，不能替换本课内容。`,
      "请生成一节 40 分钟课堂可用的备课成果，包含：",
      "1. 可上课教学设计；",
      "2. PPT 脚本；",
      "3. 10分钟随堂检测；",
      "4. 课后分层作业。",
      "年级适配要求：根据所选年级自动调整语言难度、活动形式、课堂节奏和输出任务。低年级突出听说、TPR、图片、儿歌和自然拼读启蒙；中年级突出词句操练、对话表演和语篇初读；高年级突出阅读策略、写作支架、综合语用和初中衔接。",
      "要求语言简明、步骤清楚、适合一线教师直接修改使用。",
    ].join("\n");
  }

  type KnowledgeContextPhase = "student-profile" | "lesson-skeleton" | "ppt-script" | "assessment";

  function clipContextText(value: string, maxLength: number) {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}\n\n【上下文已压缩，仅保留与本阶段最相关的内容】`;
  }

  function filesForKnowledgePhase(phase: KnowledgeContextPhase) {
    const categoryHints: Record<KnowledgeContextPhase, string[]> = {
      "student-profile": ["班情", "错题", "课标", "教材"],
      "lesson-skeleton": ["教材", "课标", "模板", "词句", "语篇"],
      "ppt-script": ["词句", "语篇", "教材", "模板"],
      assessment: ["错题", "检测", "课标", "教材", "模板"],
    };
    const hints = categoryHints[phase];
    const filtered = selectedKnowledgeFiles.filter((file) =>
      hints.some((hint) => `${file.category} ${file.metadata.tags.join(" ")} ${file.name}`.includes(hint)),
    );

    return filtered.length ? filtered : selectedKnowledgeFiles;
  }

  function knowledgeLimitForPhase(phase: KnowledgeContextPhase) {
    const limits: Record<KnowledgeContextPhase, number> = {
      "student-profile": 4,
      "lesson-skeleton": 5,
      "ppt-script": 3,
      assessment: 4,
    };
    return limits[phase];
  }

  function buildKnowledgeContextForTask(task: string, phase: KnowledgeContextPhase) {
    const references = retrieveKnowledgeChunks(filesForKnowledgePhase(phase), buildRetrievalQuery(task), knowledgeLimitForPhase(phase))
      .map(
        (item, index) =>
          `【引用${index + 1}｜${item.file.metadata.subject}｜${item.file.category}｜${item.file.name}｜${item.file.metadata.grade || "未标年级"}｜${item.file.metadata.unit || "未标单元"}｜${item.file.metadata.lessonType || "未标课型"}｜片段${item.chunk.index + 1}】\n标签：${item.file.metadata.tags.join("、") || "无"}\n片段摘要：${item.chunk.summary}\n片段内容：\n${item.chunk.text}`,
      )
      .join("\n\n");
    const constraint = [
      "【本次资料引用硬约束】",
      `目标课题：${selectedTextbookVersion} ${gradeLevel}${semester} ${unitLabel.trim() || "未填写"} ${lessonTitle.trim() || "未填写"}（${lessonType}）`,
      "若下方引用资料与目标课题的年级、册别、Unit / Module 或课时主题冲突，必须忽略冲突内容，只能参考其格式。",
    ].join("\n");

    const contextLength: Record<KnowledgeContextPhase, number> = {
      "student-profile": 3600,
      "lesson-skeleton": 5200,
      "ppt-script": 1400,
      assessment: 4200,
    };

    return references ? `${constraint}\n\n${clipContextText(references, contextLength[phase])}` : constraint;
  }

  function buildRetrievalQuery(task = taskInput) {
    return [
      activeSubjectProfile.name,
      selectedTextbookVersion,
      gradeLevel,
      semester,
      unitLabel,
      lessonTitle,
      lessonType,
      task,
    ].join("\n");
  }

  const lessonTemplates = [
    {
      label: "词汇课",
      grade: "三年级",
      semester: "下册" as Semester,
      unit: "Unit 4",
      title: "Where is my car? Part A Let's learn",
    },
    {
      label: "对话课",
      grade: "四年级",
      semester: "上册" as Semester,
      unit: "Unit 3",
      title: "My friends Part B Let's talk",
    },
    {
      label: "阅读课",
      grade: "五年级",
      semester: "下册" as Semester,
      unit: "Unit 2",
      title: "My favourite season Read and write",
    },
    {
      label: "复习课",
      grade: "六年级",
      semester: "下册" as Semester,
      unit: "Unit 3",
      title: "Where did you go? 单元复习",
    },
    {
      label: "讲评课",
      grade: "六年级",
      semester: "下册" as Semester,
      unit: "阶段检测",
      title: "阶段测试典型错题讲评",
    },
  ];

  function extractKeywords(text: string) {
    const stopWords = new Set([
      "请以",
      "输出",
      "生成",
      "设计",
      "一节",
      "分钟",
      "教案",
      "脚本",
      "作业",
      "检测",
      "the",
      "and",
      "for",
      "with",
      "unit",
    ]);
    const unitSignals = extractUnitSignals(text);
    const matches = text
      .toLowerCase()
      .match(/[a-z][a-z0-9-]{2,}|[\u4e00-\u9fa5]{2,8}/g);

    return Array.from(new Set([...unitSignals, ...(matches || [])]))
      .filter((word) => !stopWords.has(word) && word.length >= 2)
      .slice(0, 24);
  }

  function chineseNumberToInt(value: string) {
    const digits: Record<string, number> = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
    };
    if (/^\d+$/.test(value)) return Number(value);
    if (value === "十") return 10;
    if (value.startsWith("十")) return 10 + (digits[value.slice(1)] || 0);
    if (value.endsWith("十")) return (digits[value[0]] || 0) * 10;
    if (value.includes("十")) {
      const [ten, one] = value.split("十");
      return (digits[ten] || 1) * 10 + (digits[one] || 0);
    }
    return digits[value] || 0;
  }

  function extractUnitSignals(text: string) {
    const signals: string[] = [];
    for (const match of text.matchAll(/\b(unit|module)\s*([0-9]{1,2})\b/gi)) {
      signals.push(`${match[1].toLowerCase()}-${Number(match[2])}`);
    }
    for (const match of text.matchAll(/第([一二三四五六七八九十\d]{1,3})单元/g)) {
      const unitNumber = chineseNumberToInt(match[1]);
      if (unitNumber) signals.push(`unit-${unitNumber}`);
    }
    return Array.from(new Set(signals));
  }

  function targetUnitSignal() {
    return extractUnitSignals(`${unitLabel} ${lessonTitle} ${taskInput}`)[0] || "";
  }

  function lastUnitSignal(text: string) {
    const matches = extractUnitSignals(text);
    return matches[matches.length - 1] || "";
  }

  function summarizeText(text: string, maxLength = 160) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return "暂无摘要。";
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
  }

  function buildKnowledgeChunks(content: string, fileName: string): KnowledgeChunk[] {
    const normalized = content.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!normalized) return [];

    const chunkSize = 900;
    const overlap = 100;
    const chunks: KnowledgeChunk[] = [];

    for (let start = 0; start < normalized.length; start += chunkSize - overlap) {
      const text = normalized.slice(start, start + chunkSize).trim();
      if (!text) continue;
      const contextUnit = lastUnitSignal(normalized.slice(0, start + text.length));
      chunks.push({
        id: `${fileName}-${chunks.length}`,
        index: chunks.length,
        text,
        summary: summarizeText(text, 120),
        keywords: Array.from(new Set([...extractKeywords(`${fileName} ${text}`), contextUnit].filter(Boolean))),
      });
    }

    return chunks;
  }

  function applyLessonTemplate(template: { label: string; grade: string; semester: Semester; unit: string; title: string }) {
    setLessonType(template.label);
    setGradeLevel(template.grade);
    setUploadGrade(template.grade);
    setSemester(template.semester);
    setUnitLabel(template.unit);
    setUploadUnit(template.unit);
    setLessonTitle(template.title);
    setTaskInput(
      `请为${selectedTextbookVersion} ${template.grade}${template.semester} ${template.unit} ${template.title} 设计一节 40 分钟${template.label}，输出可上课教案、PPT脚本、10分钟随堂检测和课后分层作业。`,
    );
    setStatus(`已套用模板：${template.label}`);
  }

  function inferGrade(value: string) {
    const match = value.match(/[一二三四五六\d][年级]/);
    return match?.[0].replace("年", "年级") || uploadGrade || gradeLevel || "";
  }

  function inferUnit(value: string) {
    const unitMatch = value.match(/Unit\s*\d+[^，。；;\n]*/i);
    if (unitMatch) return unitMatch[0].trim();
    const moduleMatch = value.match(/Module\s*\d+[^，。；;\n]*/i);
    if (moduleMatch) return moduleMatch[0].trim();
    const lessonMatch = value.match(/第[一二三四五六七八九十\d]+[单课章节][^，。；;\n]*/);
    return lessonMatch?.[0].trim() || uploadUnit || unitLabel || "";
  }

  function parseTags(value: string) {
    return Array.from(
      new Set(
        value
          .split(/[，,、\s]+/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ).slice(0, 12);
  }

  function normalizeKnowledgeCategory(category: unknown): KnowledgeCategory {
    const value = typeof category === "string" ? category : "";
    if (knowledgeCategories.includes(value)) return value;
    if (value.includes("错题")) return knowledgeCategories.find((item) => item.includes("错题")) || knowledgeCategories[0] || "教材课标";
    if (value.includes("学情") || value.includes("班情")) return knowledgeCategories.find((item) => item.includes("班情")) || knowledgeCategories[0] || "教材课标";
    if (value.includes("模板")) return knowledgeCategories.find((item) => item.includes("模板")) || knowledgeCategories[0] || "教材课标";
    if (value.includes("教材") || value.includes("课标")) return knowledgeCategories.find((item) => item.includes("教材") || item.includes("课标")) || knowledgeCategories[0] || "教材课标";
    return knowledgeCategories[0] || "教材课标";
  }

  function normalizeKnowledgeMetadata(
    file: Partial<KnowledgeFile> & { name: string; content?: string },
    category: KnowledgeCategory,
  ): KnowledgeMetadata {
    const legacyMetadata = (file.metadata || {}) as Partial<KnowledgeMetadata>;
    const searchable = `${structuredLessonName} ${taskInput} ${file.name} ${file.content || ""}`;

    return {
      subject: activeSubjectProfile.name,
      grade: legacyMetadata.grade || inferGrade(searchable),
      unit: legacyMetadata.unit || inferUnit(searchable),
      lessonType: legacyMetadata.lessonType || lessonType,
      tags: legacyMetadata.tags?.length
        ? legacyMetadata.tags
        : parseTags(`${category} ${uploadTags}`),
    };
  }

  function normalizeKnowledgeFile(file: Partial<KnowledgeFile> & { id: string; name: string; content?: string }) {
    const content = file.content || "";
    const chunks = content ? buildKnowledgeChunks(content, file.name) : file.chunks?.length ? file.chunks : [];
    const category = normalizeKnowledgeCategory(file.category);

    return {
      ...file,
      content,
      category,
      metadata: normalizeKnowledgeMetadata({ ...file, content }, category),
      summary: file.summary || summarizeText(content, 180),
      chunks,
      createdAt: file.createdAt || new Date().toISOString(),
      selected: file.selected ?? true,
      uploading: false,
    } satisfies KnowledgeFile;
  }

  function scoreKnowledgeChunk(chunk: KnowledgeChunk, file: KnowledgeFile, queryKeywords: string[]) {
    const metadataText = [
      file.metadata.subject,
      file.metadata.grade,
      file.metadata.unit,
      file.metadata.lessonType,
      file.metadata.tags.join(" "),
    ].join(" ");
    const searchable = `${file.name} ${file.category} ${metadataText} ${chunk.summary} ${chunk.keywords.join(" ")} ${chunk.text}`.toLowerCase();
    const targetUnit = targetUnitSignal();
    const fileUnitSignals = extractUnitSignals(file.metadata.unit);
    const chunkUnitSignals = extractUnitSignals(`${chunk.summary} ${chunk.keywords.join(" ")} ${chunk.text}`);
    const chunkHasTargetUnit = Boolean(targetUnit && chunkUnitSignals.includes(targetUnit));
    const chunkHasOtherUnit = Boolean(targetUnit && chunkUnitSignals.length && !chunkHasTargetUnit);
    const keywordScore = queryKeywords.reduce((score, keyword) => {
      const normalized = keyword.toLowerCase();
      if (!normalized) return score;
      if (normalized === targetUnit && chunkHasTargetUnit) return score + 10;
      if (normalized === targetUnit && fileUnitSignals.includes(targetUnit)) return score + 6;
      if (file.metadata.grade.toLowerCase().includes(normalized)) return score + 4;
      if (file.metadata.lessonType.toLowerCase().includes(normalized)) return score + 3;
      if (file.category.toLowerCase().includes(normalized)) return score + 2;
      return score + (searchable.includes(normalized) ? 1 : 0);
    }, 0);
    const subjectBonus = file.metadata.subject === activeSubjectProfile.name ? 3 : 0;
    const targetUnitBonus = chunkHasTargetUnit ? 30 : fileUnitSignals.includes(targetUnit) ? 8 : 0;
    const conflictingUnitPenalty = chunkHasOtherUnit ? -18 : targetUnit && fileUnitSignals.length && !fileUnitSignals.includes(targetUnit) ? -6 : 0;
    return keywordScore + subjectBonus + targetUnitBonus + conflictingUnitPenalty;
  }

  function retrieveKnowledgeChunks(files: KnowledgeFile[], query: string, limit: number) {
    const queryKeywords = extractKeywords(query);
    const targetUnit = targetUnitSignal();
    const ranked = files.flatMap((file) =>
      file.chunks.map((chunk) => ({
        file,
        chunk,
        score: scoreKnowledgeChunk(chunk, file, queryKeywords),
      })),
    );
    const exactUnitMatches = targetUnit
      ? ranked.filter((item) =>
          extractUnitSignals(`${item.chunk.summary} ${item.chunk.keywords.join(" ")} ${item.chunk.text}`).includes(targetUnit),
        )
      : [];
    const candidates =
      exactUnitMatches.length >= 2
        ? [...exactUnitMatches, ...ranked.filter((item) => !exactUnitMatches.includes(item))]
        : ranked;

    return candidates
      .sort((a, b) => b.score - a.score || a.file.createdAt.localeCompare(b.file.createdAt))
      .slice(0, limit);
  }

  function formatOutputForContext(output: (typeof outputs)[number], note = "") {
    const detail = output.detail?.trim() || output.items.map((item) => `  * ${item}`).join("\n");
    return `\n\n### 【${output.group}】的产出${note ? `（${note}）` : ""}：\n- 标题：${output.title}\n- 摘要：${output.summary}\n- 要点：\n${output.items.map((item) => `  * ${item}`).join("\n")}\n\n${detail ? `完整内容：\n${detail}` : ""}`;
  }

  function buildPptCompressedContext(records: typeof outputs) {
    const lessonSkeleton = records.find((output) => output.group === "集体备课组");
    const studentProfile = records.find((output) => output.group === "学情分析组");
    const skeletonDetail = lessonSkeleton ? getOutputDetail(lessonSkeleton) : "";
    const studentSummary = studentProfile
      ? [`学情摘要：${studentProfile.summary}`, ...studentProfile.items.map((item) => `- ${item}`)].join("\n")
      : "";

    return clipContextText(
      [
        "【PPT脚本组压缩上下文】",
        "请只依据以下信息生成逐页 PPT 脚本，不要读取或复述完整教案全文。",
        `课题：${structuredLessonName}`,
        `课型：${lessonType}`,
        studentSummary,
        lessonSkeleton
          ? [
              `教学骨架标题：${lessonSkeleton.title}`,
              `教学骨架摘要：${lessonSkeleton.summary}`,
              "教学目标、4 个 Step 活动链、核心词句/语篇材料、PPT 页码大纲：",
              skeletonDetail,
            ].join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      2800,
    );
  }

  const openKnowledgeDb = useCallback(() => {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(knowledgeDbName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(knowledgeStoreName)) {
          db.createObjectStore(knowledgeStoreName, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, []);

  const readKnowledgeFiles = useCallback(async () => {
    const db = await openKnowledgeDb();
    return new Promise<KnowledgeFile[]>((resolve, reject) => {
      const transaction = db.transaction(knowledgeStoreName, "readonly");
      const store = transaction.objectStore(knowledgeStoreName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result as KnowledgeFile[]);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
    });
  }, [openKnowledgeDb]);

  const saveKnowledgeFile = useCallback(async (file: KnowledgeFile) => {
    const db = await openKnowledgeDb();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(knowledgeStoreName, "readwrite");
      const store = transaction.objectStore(knowledgeStoreName);
      store.put(file);

      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  }, [openKnowledgeDb]);

  const deleteKnowledgeFile = useCallback(async (id: string) => {
    const db = await openKnowledgeDb();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(knowledgeStoreName, "readwrite");
      const store = transaction.objectStore(knowledgeStoreName);
      store.delete(id);

      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  }, [openKnowledgeDb]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("peac-model-configs");
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, ModelConfig>;
        const sanitized = stripApiKeysFromModelConfigs(parsed);
        if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
          window.localStorage.setItem("peac-model-configs", JSON.stringify(sanitized));
        }
        setModelConfigs((prev) => ({
          ...prev,
          ...sanitized,
        }));
      }
    } catch {
      setStatus("本机模型设置读取失败，请重新填写。");
    }
  }, []);

  useEffect(() => {
    try {
      const savedPrompt = window.localStorage.getItem("peac-system-prompt");
      if (savedPrompt) {
        if (isLegacyPrompt(savedPrompt)) {
          window.localStorage.setItem("peac-system-prompt", defaultTeachingSystemPrompt);
          setSystemPromptOverride(defaultTeachingSystemPrompt);
          setStatus("检测到旧版系统 Prompt，已自动更新为小学英语 v1 默认规则。");
        } else {
          setSystemPromptOverride(savedPrompt);
        }
      }
    } catch {
      setStatus("本机系统 Prompt 读取失败，已使用默认规则。");
    }
  }, []);

  useEffect(() => {
    try {
      const savedSubjectPrompt = window.localStorage.getItem("peac-subject-prompt");
      if (savedSubjectPrompt) {
        if (isLegacyPrompt(savedSubjectPrompt)) {
          window.localStorage.setItem("peac-subject-prompt", defaultSubjectPrompt);
          setSubjectPromptOverride(defaultSubjectPrompt);
          setStatus("检测到旧版补充 Prompt，已自动更新为小学英语 v1 默认规则。");
        } else {
          setSubjectPromptOverride(savedSubjectPrompt);
        }
      }
    } catch {
      setStatus("本机学科 Prompt 读取失败，已使用默认英语学科规则。");
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadKnowledgeBase() {
      try {
        const files = await readKnowledgeFiles();
        if (!isMounted) return;

        setKbFiles(
          files
            .map((file) => normalizeKnowledgeFile(file))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        );
      } catch {
        if (isMounted) {
          setError("本机知识库读取失败，请确认浏览器允许本地存储。");
        }
      } finally {
        if (isMounted) {
          setIsKnowledgeReady(true);
        }
      }
    }

    loadKnowledgeBase();

    return () => {
      isMounted = false;
    };
  // The normalizer reads the fixed小学英语 profile plus current defaults; loading the
  // stored knowledge base should only happen once after IndexedDB is ready.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKnowledgeFiles]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "peac-model-configs",
        JSON.stringify(stripApiKeysFromModelConfigs(modelConfigs)),
      );
    } catch {
      // Storage may be disabled in some embedded browsers.
    }
  }, [modelConfigs]);

  useEffect(() => {
    try {
      window.localStorage.setItem("peac-system-prompt", systemPromptOverride);
    } catch {
      // Storage may be disabled in some embedded browsers.
    }
  }, [systemPromptOverride]);

  useEffect(() => {
    try {
      window.localStorage.setItem("peac-subject-prompt", subjectPromptOverride);
    } catch {
      // Storage may be disabled in some embedded browsers.
    }
  }, [subjectPromptOverride]);

  useEffect(() => {
    const nextCategories = activeSubjectProfile.categories.map((category) => category.value);
    if (!nextCategories.includes(uploadCategory)) {
      setUploadCategory(nextCategories[0] || "教材课标");
    }
    if (knowledgeCategoryFilter !== "全部" && !nextCategories.includes(knowledgeCategoryFilter)) {
      setKnowledgeCategoryFilter("全部");
    }
  }, [activeSubjectProfile.categories, knowledgeCategoryFilter, uploadCategory]);

  useEffect(() => {
    if (!runStartedAt || (!isRunning && !isPausedForHuman)) return;

    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000)));
    };

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [isPausedForHuman, isRunning, runStartedAt]);

  function updateModelConfig(field: keyof ModelConfig, value: string) {
    setModelConfigs((prev) => ({
      ...prev,
      [modelType]: {
        ...(prev[modelType] || defaultModelConfig[modelType] || defaultModelConfig.gemini),
        [field]: value,
      },
    }));
  }

  function clearCurrentApiKey() {
    updateModelConfig("apiKey", "");
    try {
      window.localStorage.setItem(
        "peac-model-configs",
        JSON.stringify(stripApiKeysFromModelConfigs(modelConfigs)),
      );
    } catch {
      // Storage may be disabled in some embedded browsers.
    }
    setStatus("已清除当前模型 API Key。");
  }

  function resetSystemPrompt() {
    setSystemPromptOverride(defaultTeachingSystemPrompt);
    setStatus("已恢复系统初始 Prompt。");
  }

  function resetSubjectPrompt() {
    setSubjectPromptOverride(defaultSubjectPrompt);
    setStatus("已恢复小学英语补充 Prompt。");
  }

  function resetAllPrompts() {
    setSystemPromptOverride(defaultTeachingSystemPrompt);
    setSubjectPromptOverride(defaultSubjectPrompt);
    setStatus("已恢复全部默认 Prompt。");
  }

  function isLegacyPrompt(value: string) {
    return [
      "小学英语六年级 AI",
      "面向小学六年级英语教师",
      "当前默认学科为：小学六年级英语",
      "可将本系统改造成",
      "切换学科时",
      "跨学科通用能力",
      "六年级下学期英语",
      "六年级英语下册",
    ].some((keyword) => value.includes(keyword));
  }

  function formatDuration(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const restMinutes = minutes % 60;
      return `${hours}:${String(restMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function markRunActivity() {
    setLastActivityAt(Date.now());
  }

  function applyDomesticPreset(provider: "kimi" | "deepseek-v4-flash" | "deepseek-v4-pro" | "qwen" | "zhipu" | "doubao") {
    const presets = {
      kimi: {
        baseUrl: "https://api.moonshot.cn/v1",
        modelName: "kimi-k2.6",
        status: "已切换到 Kimi 接口预设，请确认 API Key 正确。",
      },
      "deepseek-v4-flash": {
        baseUrl: "https://api.deepseek.com/chat/completions",
        modelName: "deepseek-v4-flash",
        status: "已切换到 DeepSeek V4 Flash 预设，适合更快生成。",
      },
      "deepseek-v4-pro": {
        baseUrl: "https://api.deepseek.com/chat/completions",
        modelName: "deepseek-v4-pro",
        status: "已切换到 DeepSeek V4 Pro 预设，适合更高质量生成。",
      },
      qwen: {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        modelName: "qwen-plus",
        status: "已切换到通义千问接口预设，请确认 API Key 正确。",
      },
      zhipu: {
        baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        modelName: "glm-4-flash",
        status: "已切换到智谱 GLM 接口预设，请确认 API Key 正确。",
      },
      doubao: {
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
        modelName: "doubao-seed-1-6-flash",
        status: "已切换到豆包接口预设，请确认 API Key 与模型名称正确。",
      },
    } satisfies Record<
      "kimi" | "deepseek-v4-flash" | "deepseek-v4-pro" | "qwen" | "zhipu" | "doubao",
      { baseUrl: string; modelName: string; status: string }
    >;

    const preset = presets[provider];

    setModelType("domestic");
    setModelConfigs((prev) => ({
      ...prev,
      domestic: {
        ...(prev.domestic || defaultModelConfig.domestic),
        ...preset,
      },
    }));
    setStatus(preset.status);
  }

  const handleCopy = async () => {
    const textToCopy = activePreviewContent;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  function buildDownloadFileName(label: string) {
    const date = new Date().toISOString().slice(0, 10);
    const normalizedTask = taskInput
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "")
      .slice(0, 24);
    return `${normalizedTask || "教研产出"}-${label}-${date}.md`;
  }

  function downloadMarkdown(label: string, content: string) {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildDownloadFileName(label);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadFromApi(
    kind: "docx" | "pptx" | "xlsx" | "package",
    label: string,
    payload: Record<string, string>,
  ) {
    try {
      setStatus(`正在生成${label}文件...`);
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          fileName: buildDownloadFileName(label).replace(/\.md$/, ""),
          lessonTitle,
          ...payload,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || `导出失败（HTTP ${res.status}）`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const encodedFileName = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      const fileName = encodedFileName ? decodeURIComponent(encodedFileName) : buildDownloadFileName(label);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus(`${label}已生成并开始下载。`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "未知错误";
      setError(message);
      setStatus("导出已中断。");
    }
  }

  function downloadOffice(kind: "docx" | "pptx" | "xlsx", label: string, markdown: string) {
    downloadFromApi(kind, label, { markdown });
  }

  function downloadLessonPackage() {
    downloadFromApi("package", "本节课资料包", {
      teachingDesign: splitFinalDeliverables.teachingDesign,
      pptScript: splitFinalDeliverables.pptScript,
      inClassTest: splitFinalDeliverables.assessment || splitFinalDeliverables.inClassTest,
      homework: splitFinalDeliverables.homework,
    });
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];

    const fileItem: KnowledgeFile = {
      id: `${Date.now()}-${file.name}`,
      name: file.name,
      category: uploadCategory,
      metadata: {
        subject: activeSubjectProfile.name,
        grade: inferGrade(`${file.name} ${lessonTitle} ${taskInput}`),
        unit: uploadUnit.trim() || unitLabel.trim() || inferUnit(`${file.name} ${lessonTitle} ${taskInput}`),
        lessonType,
        tags: parseTags(uploadTags || uploadCategory),
      },
      summary: "正在解析资料内容...",
      chunks: [],
      content: "",
      createdAt: new Date().toISOString(),
      selected: true,
      uploading: true,
    };
    setKbFiles((prev) => [...prev, fileItem]);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json().catch(() => ({}))) as { content?: unknown; error?: unknown };
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "上传接口返回异常");
      }
      if (typeof data.content !== "string") {
        throw new Error("上传接口未返回可用文本内容");
      }

      const chunks = buildKnowledgeChunks(data.content, file.name);
      const savedFile: KnowledgeFile = {
        ...fileItem,
        content: data.content,
        metadata: {
          ...fileItem.metadata,
          grade: fileItem.metadata.grade || inferGrade(`${file.name} ${data.content}`),
          unit: fileItem.metadata.unit || inferUnit(`${file.name} ${data.content}`),
        },
        summary: summarizeText(data.content, 180),
        chunks,
        uploading: false,
      };
      await saveKnowledgeFile(savedFile);

      setKbFiles((prev) => prev.map((f) => (f.id === fileItem.id ? savedFile : f)));
      setStatus(`已加入校本资料库：${uploadCategory} / ${file.name}，已切分为 ${chunks.length} 个片段。`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "未知错误";
      setError(`资料上传失败：${message}`);
      setKbFiles((prev) => prev.filter((f) => f.id !== fileItem.id));
    }
    
    // Clear input
    e.target.value = "";
  }

  async function removeKbFile(id: string) {
    const file = kbFiles.find((item) => item.id === id);

    try {
      await deleteKnowledgeFile(id);
      setKbFiles((prev) => prev.filter((f) => f.id !== id));
      setStatus(file ? `已从本地知识库删除：${file.name}` : "已删除知识库资料。");
    } catch {
      setError("删除本地知识库资料失败，请稍后重试。");
    }
  }

  async function toggleKnowledgeFile(id: string) {
    const file = kbFiles.find((item) => item.id === id);
    if (!file || file.uploading) return;

    const nextFile = { ...file, selected: !file.selected };

    try {
      await saveKnowledgeFile(nextFile);
      setKbFiles((prev) => prev.map((item) => (item.id === id ? nextFile : item)));
    } catch {
      setError("更新资料选择状态失败，请稍后重试。");
    }
  }

  async function updateKnowledgeCategory(id: string, category: KnowledgeCategory) {
    const file = kbFiles.find((item) => item.id === id);
    if (!file || file.uploading) return;

    const nextFile = { ...file, category, metadata: { ...file.metadata, tags: parseTags(`${file.metadata.tags.join(" ")} ${category}`) } };

    try {
      await saveKnowledgeFile(nextFile);
      setKbFiles((prev) => prev.map((item) => (item.id === id ? nextFile : item)));
      setStatus(`已将资料归类为：${category}`);
    } catch {
      setError("更新资料类型失败，请稍后重试。");
    }
  }

  async function updateKnowledgeMetadata(id: string, field: "grade" | "unit" | "lessonType" | "tags", value: string) {
    const file = kbFiles.find((item) => item.id === id);
    if (!file || file.uploading) return;

    const nextFile: KnowledgeFile = {
      ...file,
      metadata: {
        ...file.metadata,
        [field]: field === "tags" ? parseTags(value) : value,
      },
    };

    try {
      await saveKnowledgeFile(nextFile);
      setKbFiles((prev) => prev.map((item) => (item.id === id ? nextFile : item)));
    } catch {
      setError("更新资料元数据失败，请稍后重试。");
    }
  }

  async function startPhase1(taskOverride?: string) {
    if (!activeModelConfig.apiKey.trim()) {
      setError("请先在高级设置中填写当前模型的 API Key。");
      return;
    }

    const currentTask = taskOverride || taskInput;
    const startedAt = Date.now();
    setRunStartedAt(startedAt);
    setLastActivityAt(startedAt);
    setElapsedSeconds(0);
    setIsRunning(true);
    setIsPausedForHuman(false);
    setError("");
    setFinalResult("");
    setStatus("正在读取资料并生成备课材料…");

    const sequence = ["学情分析组", "集体备课组"];
    
    // 初始化状态为待生成
    setOutputs(
      sequence.map((group) => ({
        group,
        title: "等待中...",
        summary: "等待前置节点完成...",
        items: [],
        meta: { updatedAt: "", state: "待生成" as const },
        isEditing: false,
        isExpanded: false,
      }))
    );

    let context = "";

    try {
      for (let i = 0; i < sequence.length; i++) {
        const group = sequence[i];

        setOutputs((prev) => {
          const next = [...prev];
          next[i] = {
            ...next[i],
            title: "生成中...",
            summary: "AI 正在分析并生成...",
            meta: { updatedAt: "刚刚", state: "生成中" },
          };
          return next;
        });

        setStatus(`正在执行节点：${group}...`);
        setCurrentWorkflowStep(group);
        markRunActivity();

        const res = await fetch("/api/models/group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            input: currentTask, 
            group, 
            context, 
            modelType,
            modelSettings,
            knowledgeBaseText: buildKnowledgeContextForTask(
              currentTask,
              group === "学情分析组" ? "student-profile" : "lesson-skeleton",
            ),
            systemPromptOverride,
            subjectPromptOverride,
          }),
        });

        const data = await res.json();

        if (res.ok && data.content) {
          markRunActivity();
          const outputRecord = {
            group,
            title: data.content.title || "无标题",
            summary: data.content.summary || "",
            items: Array.isArray(data.content.items) ? data.content.items : [],
            detail: typeof data.content.detail === "string" ? data.content.detail : "",
            meta: { updatedAt: new Date().toLocaleTimeString(), state: "已生成" as const },
            isEditing: group === "集体备课组",
            isExpanded: group === "集体备课组",
          };

          setOutputs((prev) => {
            const next = [...prev];
            next[i] = outputRecord;
            return next;
          });

          context += formatOutputForContext(outputRecord);

        } else {
          setOutputs((prev) => {
            const next = [...prev];
            next[i] = {
              ...next[i],
              title: "生成失败",
              summary: data?.error || `HTTP ${res.status}`,
              meta: { updatedAt: new Date().toLocaleTimeString(), state: "生成失败" },
            };
            return next;
          });
          throw new Error(`${group} 生成失败：${data?.error || res.statusText}`);
        }
      }

      setAccumulatedContext(context);
      setIsPausedForHuman(true);
      setCurrentWorkflowStep("人工确认教案");
      markRunActivity();
      setStatus("教学设计骨架已生成。请确认是否可用；确认后将并行生成详细教案、检测作业和 PPT 脚本。");
    } catch (e) {
      markRunActivity();
      const message = e instanceof Error ? e.message : "生成失败：未知错误。";
      setError(message);
      setStatus("生成已中断。");
      setCurrentWorkflowStep("");
    } finally {
      setIsRunning(false);
    }
  }

  async function startPhase2(taskOverride?: string) {
    if (!activeModelConfig.apiKey.trim()) {
      setError("请先在高级设置中填写当前模型的 API Key。");
      return;
    }

    const currentTask = taskOverride || taskInput;
    if (!runStartedAt) {
      const startedAt = Date.now();
      setRunStartedAt(startedAt);
      setElapsedSeconds(0);
    }
    markRunActivity();
    setIsRunning(true);
    setIsPausedForHuman(false);
    setError("");
    setStatus("正在基于确认后的教学骨架并行生成详细教案、检测作业和 PPT 脚本…");
    
    const sequence = ["详细教案组", "检测作业组", "PPT脚本组"];
    const generatedGroupSet = new Set(sequence);
    const confirmedOutputs = outputs.filter((output) => !generatedGroupSet.has(output.group));
    
    setOutputs((prev) => [
      ...prev.filter((output) => !generatedGroupSet.has(output.group)),
      ...sequence.map((group) => ({
        group,
        title: "等待中...",
        summary: "等待前置节点完成...",
        items: [],
        meta: { updatedAt: "", state: "待生成" as const },
        isEditing: false,
        isExpanded: false,
      }))
    ]);

    // 如果用户修改了前两步的卡片，我们需要重新获取最新的内容作为上下文
    const updatedContext = confirmedOutputs.map(o => 
      `\n\n### 【${o.group}】的产出（可能经人工修改）：\n- 标题：${o.title}\n- 摘要：${o.summary}\n- 要点：\n${o.items.map(item => `  * ${item}`).join("\n")}\n\n${o.detail ? `完整内容：\n${o.detail}` : ""}`
    ).join("");
    const confirmedContext = updatedContext || accumulatedContext;
    const pptContext = buildPptCompressedContext(confirmedOutputs);

    try {
      setCurrentWorkflowStep("资源并行生成");
      markRunActivity();
      const generatedOutputs = await Promise.all(sequence.map(async (group) => {
        setOutputs((prev) => {
          return prev.map((output) => output.group === group ? {
            ...output,
            title: "生成中...",
            summary: "AI 正在分析并生成...",
            meta: { updatedAt: "刚刚", state: "生成中" },
          } : output);
        });

        setStatus("正在并行执行：详细教案组、检测作业组、PPT脚本组...");
        markRunActivity();
        const knowledgePhase =
          group === "PPT脚本组"
            ? "ppt-script"
            : group === "检测作业组"
              ? "assessment"
              : "lesson-skeleton";
        const groupContext = group === "PPT脚本组" ? pptContext : confirmedContext;
        const knowledgeText =
          group === "PPT脚本组"
            ? clipContextText(buildKnowledgeContextForTask(currentTask, "ppt-script"), 1200)
            : buildKnowledgeContextForTask(currentTask, knowledgePhase);

        const res = await fetch("/api/models/group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            input: currentTask, 
            group, 
            context: groupContext, 
            modelType,
            modelSettings,
            knowledgeBaseText: knowledgeText,
            systemPromptOverride,
            subjectPromptOverride,
          }),
        });

        const data = await res.json();

        if (res.ok && data.content) {
          markRunActivity();
          const outputRecord = {
            group,
            title: data.content.title || "无标题",
            summary: data.content.summary || "",
            items: Array.isArray(data.content.items) ? data.content.items : [],
            detail: typeof data.content.detail === "string" ? data.content.detail : "",
            meta: { updatedAt: new Date().toLocaleTimeString(), state: "已生成" as const },
            isEditing: false,
            isExpanded: false,
          };

          setOutputs((prev) => {
            return prev.map((output) => output.group === group ? outputRecord : output);
          });

          return outputRecord;
        } else {
          setOutputs((prev) => {
            return prev.map((output) => output.group === group ? {
              ...output,
              title: "生成失败",
              summary: data?.error || `HTTP ${res.status}`,
              meta: { updatedAt: new Date().toLocaleTimeString(), state: "生成失败" },
            } : output);
          });
          throw new Error(`${group} 生成失败：${data?.error || res.statusText}`);
        }
      }));

      setStatus("正在整理最终材料...");
      setCurrentWorkflowStep("总控汇总");
      markRunActivity();
      const finalOutputs = [
        ...confirmedOutputs,
        ...generatedOutputs,
      ];
      const finalContent = buildFinalMarkdown(currentTask, finalOutputs);
      setFinalResult(finalContent);
      setStatus("全部备课材料已生成。");
      setCurrentWorkflowStep("");
      markRunActivity();
    } catch (e) {
      markRunActivity();
      const message = e instanceof Error ? e.message : "生成失败：未知错误。";
      setError(message);
      setStatus("生成已中断。");
      setCurrentWorkflowStep("");
    } finally {
      setIsRunning(false);
    }
  }

  function updateOutput(index: number, field: string, value: string | string[]) {
    setOutputs((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function getOutputDetail(output: (typeof outputs)[number]) {
    return output.detail?.trim() || output.items.map((item) => `- ${item}`).join("\n");
  }

  function onStart() {
    const prompt = buildTeacherPrompt();
    setTaskInput(prompt);
    if (isPausedForHuman) {
      startPhase2(prompt);
    } else {
      startPhase1(prompt);
    }
  }

  const cardClass =
    "rounded-2xl border border-white/10 bg-white/85 p-5 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.35)] backdrop-blur dark:border-white/10 dark:bg-[#111317]/92";
  const cardTitleClass = "text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50";
  const subtleTextClass = "text-xs text-zinc-500 dark:text-zinc-400";
  const formatKnowledgeTime = (value: string) =>
    new Date(value).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-zinc-950 dark:bg-[#0f1115] dark:text-zinc-50">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
        <header className="flex flex-col gap-3">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-black/5 bg-white px-3 py-1 text-xs font-medium text-zinc-500 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <GraduationCap size={14} />
            小学英语科组专用
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">小学英语智能备课教研协作中心 v1</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                面向 1-6 年级英语教师，按教材、年级、单元和课时类型生成可编辑备课资料包。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAdvancedSettings((value) => !value)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-black/5 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10"
            >
              <Sparkles size={16} />
              {showAdvancedSettings ? "收起后台" : "查看后台设置 / 进度"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-100">
            {error}
          </div>
        ) : null}

        {status ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-100">
            {status}
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-[#171a20] sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">开始备课</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">按小学英语真实备课信息填写，系统会自动适配年级。</p>
              </div>
              <span className="rounded-full bg-[#2453ff]/10 px-3 py-1 text-xs font-medium text-[#2453ff] dark:text-[#9bb1ff]">
                {workflowProgress}%
              </span>
            </div>

            <div className="mb-6 h-2 rounded-full bg-zinc-100 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-[#2453ff] transition-all"
                style={{ width: `${workflowProgress}%` }}
              />
            </div>

            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  教材版本
                  <select
                    value={textbookVersion}
                    onChange={(e) => setTextbookVersion(e.target.value as TextbookVersion)}
                    className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-base text-zinc-950 outline-none transition focus:border-[#2453ff]/40 focus:ring-4 focus:ring-[#2453ff]/10 dark:border-white/10 dark:bg-[#0f1115] dark:text-zinc-50"
                  >
                    {textbookOptions.map((version) => (
                      <option key={version} value={version}>{version}</option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  年级
                  <select
                    value={gradeLevel}
                    onChange={(e) => {
                      setGradeLevel(e.target.value);
                      setUploadGrade(e.target.value);
                    }}
                    className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-base text-zinc-950 outline-none transition focus:border-[#2453ff]/40 focus:ring-4 focus:ring-[#2453ff]/10 dark:border-white/10 dark:bg-[#0f1115] dark:text-zinc-50"
                  >
                    {gradeOptions.map((grade) => (
                      <option key={grade} value={grade}>{grade}</option>
                    ))}
                  </select>
                </label>
              </div>

              {textbookVersion === "自定义" ? (
                <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  自定义教材名称
                  <input
                    type="text"
                    value={customTextbookVersion}
                    onChange={(e) => setCustomTextbookVersion(e.target.value)}
                    placeholder="例如：本校校本英语教材"
                    className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-base text-zinc-950 outline-none transition focus:border-[#2453ff]/40 focus:ring-4 focus:ring-[#2453ff]/10 dark:border-white/10 dark:bg-[#0f1115] dark:text-zinc-50"
                  />
                </label>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  册别
                  <select
                    value={semester}
                    onChange={(e) => setSemester(e.target.value as Semester)}
                    className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-base text-zinc-950 outline-none transition focus:border-[#2453ff]/40 focus:ring-4 focus:ring-[#2453ff]/10 dark:border-white/10 dark:bg-[#0f1115] dark:text-zinc-50"
                  >
                    {semesterOptions.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  Unit / Module
                  <input
                    type="text"
                    value={unitLabel}
                    onChange={(e) => {
                      setUnitLabel(e.target.value);
                      setUploadUnit(e.target.value);
                    }}
                    placeholder="例如：Unit 3 / Module 2"
                    className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-base text-zinc-950 outline-none transition focus:border-[#2453ff]/40 focus:ring-4 focus:ring-[#2453ff]/10 dark:border-white/10 dark:bg-[#0f1115] dark:text-zinc-50"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                课时/主题
                <input
                  type="text"
                  value={lessonTitle}
                  onChange={(e) => setLessonTitle(e.target.value)}
                  placeholder="例如：Part B Let's talk / My weekend plan"
                  className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-base text-zinc-950 outline-none transition focus:border-[#2453ff]/40 focus:ring-4 focus:ring-[#2453ff]/10 dark:border-white/10 dark:bg-[#0f1115] dark:text-zinc-50"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                课时类型
                <select
                  value={lessonType}
                  onChange={(e) => setLessonType(e.target.value)}
                  className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-base text-zinc-950 outline-none transition focus:border-[#2453ff]/40 focus:ring-4 focus:ring-[#2453ff]/10 dark:border-white/10 dark:bg-[#0f1115] dark:text-zinc-50"
                >
                  {lessonTypeOptions.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap gap-2">
                {lessonTemplates.map((template) => (
                  <button
                    key={template.label}
                    type="button"
                    onClick={() => applyLessonTemplate(template)}
                    className="rounded-full border border-black/5 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-[#2453ff]/30 hover:bg-[#2453ff]/10 hover:text-[#2453ff] dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300"
                  >
                    {template.label}模板
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-black/5 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">API 配置</h3>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{activeModelLabel}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-[0.8fr_1.2fr_auto]">
                <select
                  value={
                    modelType === "gemini"
                      ? "gemini"
                      : activeModelConfig.modelName.includes("deepseek-v4-pro")
                        ? "deepseek-v4-pro"
                        : activeModelConfig.modelName.includes("deepseek")
                          ? "deepseek-v4-flash"
                          : activeModelConfig.modelName.includes("qwen")
                            ? "qwen"
                            : activeModelConfig.modelName.includes("glm")
                              ? "zhipu"
                              : activeModelConfig.modelName.includes("doubao")
                                ? "doubao"
                                : "kimi"
                  }
                  onChange={(e) => {
                    if (e.target.value === "gemini") {
                      setModelType("gemini");
                      return;
                    }
                    applyDomesticPreset(e.target.value as "kimi" | "deepseek-v4-flash" | "deepseek-v4-pro" | "qwen" | "zhipu" | "doubao");
                  }}
                  className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none dark:border-white/10 dark:bg-[#0f1115]"
                >
                  <option value="kimi">Kimi</option>
                  <option value="deepseek-v4-flash">DeepSeek Flash</option>
                  <option value="deepseek-v4-pro">DeepSeek Pro</option>
                  <option value="qwen">通义千问</option>
                  <option value="zhipu">智谱</option>
                  <option value="doubao">豆包</option>
                  {showExperimentalModels ? <option value="gemini">Gemini 实验</option> : null}
                </select>
                <input
                  type="password"
                  value={activeModelConfig.apiKey}
                  onChange={(e) => updateModelConfig("apiKey", e.target.value)}
                  placeholder="填写 API Key（默认不保存）"
                  className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none dark:border-white/10 dark:bg-[#0f1115]"
                />
                <button
                  type="button"
                  onClick={clearCurrentApiKey}
                  disabled={!activeModelConfig.apiKey.trim()}
                  className="h-11 rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10"
                >
                  清除密钥
                </button>
              </div>
            </div>

            <details className="mt-6 rounded-2xl border border-[#2453ff]/15 bg-[#2453ff]/5 p-4 dark:border-[#8fa6ff]/20 dark:bg-[#2453ff]/10">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                查看 / 修改初始 Prompt
              </summary>
              <div className="mt-4 grid gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                    修改后会立即保存到本机，并在下一次“开始备课”时传给各个智能体。
                  </p>
                  <button
                    type="button"
                    onClick={resetAllPrompts}
                    className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10"
                  >
                    全部恢复默认
                  </button>
                </div>

                <label className="flex flex-col gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  系统初始 Prompt
                  <textarea
                    value={systemPromptOverride}
                    onChange={(e) => setSystemPromptOverride(e.target.value)}
                    spellCheck={false}
                    className="min-h-[260px] w-full resize-y rounded-2xl border border-black/10 bg-white px-4 py-3 font-mono text-xs leading-5 text-zinc-900 outline-none transition focus:border-[#2453ff]/40 focus:ring-4 focus:ring-[#2453ff]/10 dark:border-white/10 dark:bg-[#0f1115] dark:text-zinc-50"
                  />
                  <span className="flex items-center justify-between gap-2 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                    <span>{systemPromptOverride.length.toLocaleString("zh-CN")} 字符</span>
                    <button
                      type="button"
                      onClick={resetSystemPrompt}
                      className="font-semibold text-[#2453ff] hover:underline dark:text-[#9bb1ff]"
                    >
                      恢复系统默认
                    </button>
                  </span>
                </label>

                <label className="flex flex-col gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  小学英语补充 Prompt
                  <textarea
                    value={subjectPromptOverride}
                    onChange={(e) => setSubjectPromptOverride(e.target.value)}
                    spellCheck={false}
                    className="min-h-[180px] w-full resize-y rounded-2xl border border-black/10 bg-white px-4 py-3 font-mono text-xs leading-5 text-zinc-900 outline-none transition focus:border-[#2453ff]/40 focus:ring-4 focus:ring-[#2453ff]/10 dark:border-white/10 dark:bg-[#0f1115] dark:text-zinc-50"
                  />
                  <span className="flex items-center justify-between gap-2 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                    <span>{subjectPromptOverride.length.toLocaleString("zh-CN")} 字符</span>
                    <button
                      type="button"
                      onClick={resetSubjectPrompt}
                      className="font-semibold text-[#2453ff] hover:underline dark:text-[#9bb1ff]"
                    >
                      恢复补充默认
                    </button>
                  </span>
                </label>

                <div className="rounded-2xl border border-black/5 bg-white p-4 dark:border-white/10 dark:bg-[#0f1115]">
                  <div className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">本次任务 Prompt 预览</div>
                  <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                    {buildTeacherPrompt()}
                  </pre>
                </div>
              </div>
            </details>

            <button
              type="button"
              onClick={onStart}
              disabled={
                isRunning ||
                !unitLabel.trim() ||
                !lessonTitle.trim() ||
                !selectedTextbookVersion.trim() ||
                !activeModelConfig.apiKey.trim() ||
                isPausedForHuman
              }
              className="mt-6 flex h-16 w-full items-center justify-center rounded-2xl bg-[#2453ff] text-lg font-semibold text-white shadow-[0_24px_60px_-28px_rgba(36,83,255,0.95)] transition hover:bg-[#1d46df] disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-white/10"
            >
              {isRunning ? "正在备课..." : isPausedForHuman ? "请先确认骨架" : "开始备课"}
            </button>

            {isPausedForHuman && firstLessonDraft ? (
              <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">教学设计骨架</h3>
                  <p className="mt-1 text-xs leading-5 text-amber-800/80 dark:text-amber-100/80">
                    可以直接确认，也可以在这里微调后继续。下一步会并行生成详细教案、检测作业和 PPT 脚本。
                  </p>
                </div>
                <textarea
                  value={firstLessonDraft.detail || getOutputDetail(firstLessonDraft)}
                  onChange={(e) => updateOutput(firstLessonDraftIndex, "detail", e.target.value)}
                  className="min-h-[220px] w-full resize-y rounded-2xl border border-amber-500/20 bg-white px-4 py-3 text-sm leading-7 text-zinc-900 outline-none focus:border-amber-500/40 focus:ring-4 focus:ring-amber-500/10 dark:bg-[#0f1115] dark:text-zinc-50"
                />
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => startPhase2(buildTeacherPrompt())}
                    disabled={isRunning}
                    className="h-11 rounded-xl bg-[#2453ff] text-sm font-semibold text-white disabled:opacity-60"
                  >
                    确认可用，并行生成
                  </button>
                  <button
                    type="button"
                    onClick={() => startPhase2(buildTeacherPrompt())}
                    disabled={isRunning}
                    className="h-11 rounded-xl border border-black/10 bg-white text-sm font-semibold text-zinc-800 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100"
                  >
                    我修改后并行生成
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <aside className="rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.35)] dark:border-white/10 dark:bg-[#171a20] sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">最终成果</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">生成完成后导出可编辑 Office 文件。</p>
              </div>
              {isFinalReady ? (
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-200">已完成</span>
              ) : (
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-500 dark:bg-white/10 dark:text-zinc-300">待生成</span>
              )}
            </div>

            <div className="grid gap-3">
              <button
                type="button"
                disabled={!isFinalReady}
                onClick={downloadLessonPackage}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#2453ff] text-sm font-semibold text-white shadow-[0_18px_48px_-28px_rgba(36,83,255,0.95)] transition hover:bg-[#1d46df] disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-white/10"
              >
                <Package size={18} />
                一键下载本节课资料包
              </button>
              <button
                type="button"
                disabled={!isFinalReady}
                onClick={() => downloadOffice("docx", "教学设计", splitFinalDeliverables.teachingDesign)}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10"
              >
                <BookOpen size={18} />
                下载教案 DOCX
              </button>
              <button
                type="button"
                disabled={!isFinalReady}
                onClick={() => downloadOffice("pptx", "PPT初稿", splitFinalDeliverables.pptScript)}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#1f7a5c] text-sm font-semibold text-white transition hover:bg-[#19664d] disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-white/10"
              >
                <FileText size={18} />
                下载 PPTX 初稿
              </button>
              <button
                type="button"
                disabled={!isFinalReady}
                onClick={() => downloadOffice("docx", "PPT脚本", splitFinalDeliverables.pptScript)}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10"
              >
                <FileText size={18} />
                下载 PPT 脚本 DOCX
              </button>
              <button
                type="button"
                disabled={!isFinalReady}
                onClick={() => downloadOffice("docx", "随堂检测题库", splitFinalDeliverables.assessment || splitFinalDeliverables.inClassTest)}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10"
              >
                <FileText size={18} />
                下载题库 DOCX
              </button>
              <button
                type="button"
                disabled={!isFinalReady}
                onClick={() => downloadMarkdown("当前预览", activePreviewContent)}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-black/5 bg-zinc-50 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300 dark:hover:bg-white/10"
              >
                <Download size={15} />
                保留 Markdown 备份
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-black/5 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="mb-2 text-sm font-semibold">当前进度</div>
              <div className="h-2 rounded-full bg-zinc-200 dark:bg-white/10">
                <div className="h-full rounded-full bg-[#2453ff] transition-all" style={{ width: `${workflowProgress}%` }} />
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                {currentWorkflowStep || (isFinalReady ? "备课完成" : "等待开始")}
              </p>
              {runStartedAt ? (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-black/5 bg-white p-3 dark:border-white/10 dark:bg-[#0f1115]">
                    <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">本次已用时</div>
                    <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
                      {formatDuration(elapsedSeconds)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-black/5 bg-white p-3 dark:border-white/10 dark:bg-[#0f1115]">
                    <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">上次更新</div>
                    <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
                      {formatDuration(secondsSinceLastActivity)}
                    </div>
                  </div>
                </div>
              ) : null}
              {runStartedAt ? (
                <div
                  className={[
                    "mt-3 rounded-xl px-3 py-2 text-xs leading-5",
                    isWaitingLong
                      ? "border border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-100"
                      : isRunning
                        ? "border border-[#2453ff]/15 bg-[#2453ff]/10 text-[#2453ff] dark:text-[#b8c6ff]"
                        : isPausedForHuman
                          ? "border border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-100"
                          : "border border-emerald-500/15 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100",
                  ].join(" ")}
                >
                  {isWaitingLong
                    ? "模型仍在等待响应。若长时间没有变化，可检查网络、API Key 或模型接口状态。"
                    : isRunning
                      ? "正在运行中，页面会在每个节点返回后更新。"
                      : isPausedForHuman
                        ? "当前暂停等待人工校订，点击继续后会接着生成后续材料。"
                        : isFinalReady
                          ? "生成已完成，可以下载资料包。"
                          : "等待开始生成。"}
                </div>
              ) : null}
            </div>

            {referencedKnowledgeFiles.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-emerald-500/15 bg-emerald-500/10 px-4 py-3 text-xs leading-5 text-emerald-800 dark:text-emerald-100">
                引用资料：{referencedKnowledgeFiles.map((file) => `${file.category}《${file.name}》`).join("、")}
              </div>
            ) : null}

            {isFinalReady ? (
              <details className="mt-4 rounded-2xl border border-black/5 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <summary className="cursor-pointer text-sm font-semibold">预览成果</summary>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    { key: "lesson", label: "教案" },
                    { key: "ppt", label: "PPT" },
                    { key: "test", label: "检测" },
                    { key: "homework", label: "作业" },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setResultView(tab.key as ResultView)}
                      className={[
                        "rounded-xl px-3 py-2 text-xs font-medium",
                        resultView === tab.key ? "bg-[#2453ff] text-white" : "bg-white text-zinc-600 dark:bg-white/5 dark:text-zinc-300",
                      ].join(" ")}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 max-h-[420px] overflow-auto rounded-xl bg-white p-4 dark:bg-[#0f1115]">
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown>{activePreviewContent}</ReactMarkdown>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-medium text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200"
                >
                  {isCopied ? <Check size={14} /> : <Copy size={14} />}
                  {isCopied ? "已复制" : "复制当前预览"}
                </button>
              </details>
            ) : null}
          </aside>
        </section>

        {showAdvancedSettings ? (
          <section className="grid gap-6 lg:grid-cols-2">
            <div className={cardClass}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className={cardTitleClass}>校本资料库</div>
                  <div className={subtleTextClass}>按小学英语资料类型归档，并用年级、单元、课时类型提高命中率。</div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <select
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value)}
                    className="rounded-xl border border-black/5 bg-white px-2.5 py-2 text-xs font-medium text-zinc-700 outline-none dark:border-white/10 dark:bg-white/5 dark:text-zinc-200"
                  >
                    {knowledgeCategories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                  <label className="cursor-pointer rounded-xl border border-dashed border-black/10 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200">
                    上传
                    <input type="file" className="hidden" accept=".pdf,.txt,.md,.csv" onChange={handleFileUpload} />
                  </label>
                </div>
              </div>
              <div className="mb-3 grid gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  value={uploadGrade}
                  onChange={(e) => setUploadGrade(e.target.value)}
                  placeholder="年级，如四年级"
                  className="rounded-xl border border-black/5 bg-white px-3 py-2 text-xs outline-none dark:border-white/10 dark:bg-white/5"
                />
                <input
                  type="text"
                  value={uploadUnit}
                  onChange={(e) => setUploadUnit(e.target.value)}
                  placeholder="单元/主题，如 Unit 3"
                  className="rounded-xl border border-black/5 bg-white px-3 py-2 text-xs outline-none dark:border-white/10 dark:bg-white/5"
                />
                <input
                  type="text"
                  value={uploadTags}
                  onChange={(e) => setUploadTags(e.target.value)}
                  placeholder="标签，用逗号分隔"
                  className="rounded-xl border border-black/5 bg-white px-3 py-2 text-xs outline-none dark:border-white/10 dark:bg-white/5"
                />
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {knowledgeCategories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => {
                      setUploadCategory(category);
                      setKnowledgeCategoryFilter(category);
                    }}
                    className={[
                      "rounded-2xl border px-3 py-2 text-left text-xs font-medium",
                      uploadCategory === category
                        ? "border-[#2453ff]/30 bg-[#2453ff]/10 text-[#2453ff]"
                        : "border-black/5 bg-white text-zinc-600 dark:border-white/5 dark:bg-white/5 dark:text-zinc-300",
                    ].join(" ")}
                  >
                    <span className="block font-semibold">{category}</span>
                    <span className="mt-0.5 block text-[11px] font-normal opacity-75">{knowledgeCategoryHints[category]}</span>
                  </button>
                ))}
              </div>
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => setKnowledgeCategoryFilter("全部")}
                  className={[
                    "rounded-full border px-3 py-1 text-xs font-medium",
                    knowledgeCategoryFilter === "全部"
                      ? "border-[#2453ff]/30 bg-[#2453ff]/10 text-[#2453ff]"
                      : "border-black/5 bg-white text-zinc-600 dark:border-white/5 dark:bg-white/5 dark:text-zinc-300",
                  ].join(" ")}
                >
                  查看全部资料
                </button>
              </div>
              <div className="max-h-[320px] overflow-auto rounded-2xl border border-black/5 bg-white/70 dark:border-white/5 dark:bg-black/10">
                {!isKnowledgeReady ? (
                  <div className="px-4 py-5 text-sm text-zinc-500">正在读取资料...</div>
                ) : visibleKnowledgeFiles.length === 0 ? (
                  <div className="px-4 py-5 text-sm text-zinc-500">暂无资料。</div>
                ) : (
                  visibleKnowledgeFiles.map((file) => (
                    <div key={file.id} className="flex items-start gap-3 border-b border-black/5 px-4 py-3 last:border-0 dark:border-white/5">
                      <input
                        type="checkbox"
                        checked={file.selected}
                        disabled={file.uploading}
                        onChange={() => toggleKnowledgeFile(file.id)}
                        className="mt-1 h-4 w-4 rounded border-zinc-300 text-[#2453ff]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold">{file.name}</span>
                          <select
                            value={file.category}
                            disabled={file.uploading}
                            onChange={(e) => updateKnowledgeCategory(file.id, e.target.value)}
                            className="rounded-lg border border-black/5 bg-white px-2 py-1 text-[11px] dark:border-white/5 dark:bg-white/5"
                          >
                            {knowledgeCategories.map((category) => (
                              <option key={category} value={category}>{category}</option>
                            ))}
                          </select>
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {file.metadata.subject} · {file.metadata.grade || "未标年级"} · {file.metadata.unit || "未标单元"} · {file.metadata.lessonType || "未标课型"} · {file.chunks.length} 个片段 · {formatKnowledgeTime(file.createdAt)}
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-4">
                          <input
                            type="text"
                            value={file.metadata.grade}
                            disabled={file.uploading}
                            onChange={(e) => updateKnowledgeMetadata(file.id, "grade", e.target.value)}
                            placeholder="年级"
                            className="rounded-lg border border-black/5 bg-white px-2 py-1 text-[11px] outline-none dark:border-white/5 dark:bg-white/5"
                          />
                          <input
                            type="text"
                            value={file.metadata.unit}
                            disabled={file.uploading}
                            onChange={(e) => updateKnowledgeMetadata(file.id, "unit", e.target.value)}
                            placeholder="单元/主题"
                            className="rounded-lg border border-black/5 bg-white px-2 py-1 text-[11px] outline-none dark:border-white/5 dark:bg-white/5"
                          />
                          <input
                            type="text"
                            value={file.metadata.lessonType}
                            disabled={file.uploading}
                            onChange={(e) => updateKnowledgeMetadata(file.id, "lessonType", e.target.value)}
                            placeholder="课型"
                            className="rounded-lg border border-black/5 bg-white px-2 py-1 text-[11px] outline-none dark:border-white/5 dark:bg-white/5"
                          />
                          <input
                            type="text"
                            value={file.metadata.tags.join("，")}
                            disabled={file.uploading}
                            onChange={(e) => updateKnowledgeMetadata(file.id, "tags", e.target.value)}
                            placeholder="标签"
                            className="rounded-lg border border-black/5 bg-white px-2 py-1 text-[11px] outline-none dark:border-white/5 dark:bg-white/5"
                          />
                        </div>
                        <div className="mt-1 max-h-10 overflow-hidden text-xs leading-5 text-zinc-500">{file.summary}</div>
                      </div>
                      <button type="button" onClick={() => removeKbFile(file.id)} className="text-xs text-zinc-500 hover:text-rose-600">删除</button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className={cardClass}>
              <div className="mb-4">
                <div className={cardTitleClass}>后台设置与进度</div>
                <div className={subtleTextClass}>只有需要排查时再看这里。</div>
              </div>
              <div className="grid gap-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
                  模型名称
                  <input
                    type="text"
                    value={activeModelConfig.modelName}
                    onChange={(e) => updateModelConfig("modelName", e.target.value)}
                    className="rounded-xl border border-black/5 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none dark:border-white/5 dark:bg-white/5 dark:text-zinc-100"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
                  {modelType === "domestic" ? "OpenAI 兼容接口地址" : "代理地址"}
                  <input
                    type="url"
                    value={modelType === "domestic" ? activeModelConfig.baseUrl : activeModelConfig.proxyUrl}
                    onChange={(e) => updateModelConfig(modelType === "domestic" ? "baseUrl" : "proxyUrl", e.target.value)}
                    className="rounded-xl border border-black/5 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none dark:border-white/5 dark:bg-white/5 dark:text-zinc-100"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={showExperimentalModels}
                    onChange={(e) => setShowExperimentalModels(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 text-[#2453ff]"
                  />
                  显示 Gemini 实验模型
                </label>
              </div>

              <div className="mt-5 rounded-2xl border border-black/5 bg-zinc-50 p-4 dark:border-white/5 dark:bg-white/[0.03]">
                <div className="mb-3 text-sm font-semibold">后台进度</div>
                <div className="space-y-2">
                  {workflow.map((step, idx) => {
                    const isActive = step === currentWorkflowStep;
                    const isPast = workflowStepIndex > idx || (finalResult && !currentWorkflowStep);
                    return (
                      <div key={`${step}-${idx}`} className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-300">
                        <span className={isActive ? "text-[#2453ff]" : isPast ? "text-emerald-600" : ""}>{isPast ? "✓" : idx + 1}</span>
                        <span>{step.replace("组", "")}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

