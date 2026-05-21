(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var TABS = [
    { id: "home", label: "首页" },
    { id: "lesson", label: "备课" },
    { id: "images", label: "课件图" },
    { id: "compare", label: "模型对比", advanced: true },
    { id: "library", label: "资料" },
    { id: "export", label: "成果" },
    { id: "settings", label: "设置" }
  ];
  var PEAC_VERSION = "v1.2.0-beta.3";
  function tabFromHash() {
    var id = (window.location.hash || "").replace(/^#/, "").trim();
    return TABS.some(function (tab) { return tab.id === id; }) ? id : "";
  }

  var activeTab = tabFromHash() || window.localStorage.getItem("peac-active-tab-v2") || "home";
  var lastSignature = "";
  var DMXAPI_CONFIG_KEY = "peac-dmxapi-relay-config-v1";
  var dmxapiFetchPatched = false;
  var dmxapiSessionApiKey = "";
  var lessonAbortControllers = [];
  var lessonProgressStartedAt = 0;
  var lessonProgressLastUpdatedAt = 0;
  var lessonProgressTimer = 0;
  var VIRTUAL_PANELS = ["home", "compare", "library", "export", "settings"];

  var comparePresets = {
    google: {
      label: "Gemini / Google",
      defaultModel: "gemini-3.1-flash-image-preview__thinking-medium",
      defaultBase: "https://generativelanguage.googleapis.com/v1beta/models",
      models: [
        ["gemini-3.1-flash-image-preview__thinking-low", "Nano Banana 2 低强度思考"],
        ["gemini-3.1-flash-image-preview__thinking-medium", "Nano Banana 2 中强度思考"],
        ["gemini-3.1-flash-image-preview__thinking-high", "Nano Banana 2 高强度思考"],
        ["gemini-3-pro-image-preview", "Nano Banana Pro"]
      ]
    },
    volcengine: {
      label: "豆包 / 火山引擎",
      defaultModel: "doubao-seedream-5-0-260128",
      defaultBase: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
      models: [
        ["doubao-seedream-5-0-260128", "Seedream 5.0"],
        ["doubao-seedream-4-5-251128", "Seedream 4.5"],
        ["doubao-seedream-4-0-250828", "Seedream 4.0"]
      ]
    },
    zhipu: {
      label: "智谱 GLM-Image",
      defaultModel: "glm-image",
      defaultBase: "https://open.bigmodel.cn/api/paas/v4/images/generations",
      models: [
        ["glm-image", "GLM-Image"],
        ["cogview-4-250304", "CogView-4 250304"],
        ["cogview-4", "CogView-4"]
      ]
    },
    aliyun: {
      label: "通义万相",
      defaultModel: "wanx2.1-t2i-plus",
      defaultBase: "https://dashscope.aliyuncs.com",
      models: [
        ["wanx2.1-t2i-plus", "万相 2.1 Plus"],
        ["wanx2.1-t2i-turbo", "万相 2.1 Turbo"],
        ["wan2.5-t2i-preview", "万相 2.5 Preview"]
      ]
    }
  };

  function textOf(node) {
    return (node && (node.innerText || node.textContent) || "").replace(/\s+/g, " ").trim();
  }

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function setText(node, value) {
    if (!node) return false;
    var next = value == null ? "" : String(value);
    if (node.textContent === next) return false;
    node.textContent = next;
    return true;
  }

  function navTabs() {
    return TABS.filter(function (tab) { return !tab.advanced; });
  }

  var DMX_TEXT_MODELS = {
    OpenAI: [
      ["gpt-5.5", "ChatGPT 5.5"],
      ["gpt-5.5-ssvip", "ChatGPT 5.5 SSVIP"],
      ["gpt-5.5-pro-ssvip", "ChatGPT 5.5 Pro SSVIP"],
      ["gpt-5-mini", "GPT-5 Mini"],
      ["gpt-5.4-pro-ssvip", "GPT-5.4 Pro SSVIP"]
    ],
    Claude: [
      ["claude-opus-4.7", "Claude Opus 4.7"],
      ["claude-sonnet-4.5", "Claude Sonnet 4.5"],
      ["claude-haiku-4.5", "Claude Haiku 4.5"]
    ],
    Google: [
      ["gemini-3-pro", "Gemini 3 Pro"],
      ["gemini-2.5-pro", "Gemini 2.5 Pro"],
      ["gemini-2.5-flash", "Gemini 2.5 Flash"]
    ],
    DeepSeek: [
      ["deepseek-v4-pro", "DeepSeek V4 Pro"],
      ["deepseek-v4-flash", "DeepSeek V4 Flash"]
    ],
    Qwen: [
      ["qwen-max", "通义千问 Max"],
      ["qwen-plus", "通义千问 Plus"]
    ],
    Other: [
      ["kimi-k2.6", "Kimi K2.6"],
      ["doubao-seed-1-6-flash", "豆包 Seed 1.6 Flash"]
    ]
  };

  var DMX_IMAGE_MODELS = {
    OpenAI: [
      ["gpt-image-2", "GPT Image 2"],
      ["gpt-image-2-ssvip", "GPT Image 2 SSVIP"],
      ["gpt-image-1", "GPT Image 1"]
    ],
    Google: [
      ["gemini-3-pro-image-preview", "Gemini 3 Pro Image"],
      ["gemini-3.1-flash-image-preview", "Gemini 3.1 Flash Image"]
    ],
    Seedream: [
      ["doubao-seedream-5-0-260128", "Seedream 5.0"],
      ["doubao-seedream-4-5-251128", "Seedream 4.5"]
    ],
    Qwen: [
      ["wan2.7-image", "万相 2.7 Image"],
      ["qwen-image", "Qwen Image"]
    ],
    Other: [
      ["flux-kontext-pro", "FLUX Kontext Pro"],
      ["midjourney", "Midjourney"]
    ]
  };

  function normalizeDmxBaseUrl(value) {
    var base = String(value || "").trim() || "https://www.dmxapi.cn/v1";
    return base.replace(/\/+$/, "");
  }

  function normalizeDmxImageModelName(provider, modelName) {
    var imageProvider = DMX_IMAGE_MODELS[provider] ? provider : "OpenAI";
    var models = DMX_IMAGE_MODELS[imageProvider] || DMX_IMAGE_MODELS.OpenAI;
    var value = String(modelName || "").trim();
    if (value === "wan2.5-t2i-preview" || value === "qwen-image") value = "wan2.7-image";
    return models.some(function (item) { return item[0] === value; }) ? value : models[0][0];
  }

  function scrubStoredDmxApiKey(saved) {
    if (!saved || typeof saved !== "object" || typeof saved.apiKey !== "string" || !saved.apiKey) return;
    try {
      var cleaned = Object.assign({}, saved);
      delete cleaned.apiKey;
      window.localStorage.setItem(DMXAPI_CONFIG_KEY, JSON.stringify(cleaned));
    } catch {}
  }

  function readDmxConfig() {
    var fallback = {
      textEnabled: false,
      imageEnabled: false,
      apiKey: "",
      baseUrl: "https://www.dmxapi.cn/v1",
      textProvider: "OpenAI",
      textModelName: "gpt-5.5",
      imageProvider: "OpenAI",
      imageModelName: "gpt-image-2",
      reasoningEffort: "medium"
    };
    try {
      var saved = JSON.parse(window.localStorage.getItem(DMXAPI_CONFIG_KEY) || "{}");
      scrubStoredDmxApiKey(saved);
      var legacyEnabled = saved.enabled === true;
      var imageProvider = typeof saved.imageProvider === "string" && DMX_IMAGE_MODELS[saved.imageProvider] ? saved.imageProvider : fallback.imageProvider;
      return {
        textEnabled: saved.textEnabled === true || legacyEnabled,
        imageEnabled: saved.imageEnabled === true,
        apiKey: dmxapiSessionApiKey,
        baseUrl: normalizeDmxBaseUrl(saved.baseUrl || fallback.baseUrl),
        textProvider: typeof saved.textProvider === "string" && DMX_TEXT_MODELS[saved.textProvider] ? saved.textProvider : fallback.textProvider,
        textModelName: typeof saved.textModelName === "string" && saved.textModelName.trim() ? saved.textModelName.trim() : (typeof saved.modelName === "string" && saved.modelName.trim() ? saved.modelName.trim() : fallback.textModelName),
        imageProvider: imageProvider,
        imageModelName: normalizeDmxImageModelName(imageProvider, saved.imageModelName || fallback.imageModelName),
        reasoningEffort: ["auto", "low", "medium", "high", "xhigh"].includes(saved.reasoningEffort) ? saved.reasoningEffort : fallback.reasoningEffort
      };
    } catch {
      return fallback;
    }
  }

  function writeDmxConfig(config) {
    dmxapiSessionApiKey = String(config.apiKey || "").trim();
    var next = {
      textEnabled: config.textEnabled === true,
      imageEnabled: config.imageEnabled === true,
      baseUrl: normalizeDmxBaseUrl(config.baseUrl),
      textProvider: DMX_TEXT_MODELS[config.textProvider] ? config.textProvider : "OpenAI",
      textModelName: String(config.textModelName || "gpt-5.5").trim() || "gpt-5.5",
      imageProvider: DMX_IMAGE_MODELS[config.imageProvider] ? config.imageProvider : "OpenAI",
      imageModelName: normalizeDmxImageModelName(config.imageProvider, config.imageModelName || "gpt-image-2"),
      reasoningEffort: ["auto", "low", "medium", "high", "xhigh"].includes(config.reasoningEffort) ? config.reasoningEffort : "medium"
    };
    next.enabled = next.textEnabled;
    next.modelName = next.textModelName;
    window.localStorage.setItem(DMXAPI_CONFIG_KEY, JSON.stringify(next));
    return next;
  }

  function isTextModelEndpoint(input) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    return /\/api\/models\/(?:chat|group)(?:\?|$)/.test(url);
  }

  function isImageModelEndpoint(input) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    return /\/api\/images\/generate(?:\?|$)/.test(url);
  }

  async function requestBodyText(input, init) {
    var bodyText = init && typeof init.body === "string" ? init.body : "";
    if (!bodyText && input && typeof input.clone === "function") {
      try {
        bodyText = await input.clone().text();
      } catch {}
    }
    return bodyText;
  }

  function patchDmxapiFetch() {
    if (dmxapiFetchPatched || typeof window.fetch !== "function") return;
    dmxapiFetchPatched = true;
    var nativeFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      var config = readDmxConfig();
      var shouldPatchText = config.textEnabled && config.apiKey && isTextModelEndpoint(input);
      var shouldPatchImage = config.imageEnabled && config.apiKey && isImageModelEndpoint(input);
      if (!shouldPatchText && !shouldPatchImage) {
        return nativeFetch(input, init);
      }
      var nextInit = Object.assign({}, init || {});
      var bodyText = await requestBodyText(input, nextInit);
      if (!bodyText) return nativeFetch(input, init);
      try {
        var payload = JSON.parse(bodyText);
        if (shouldPatchText) {
          payload.modelType = "domestic";
          payload.modelSettings = Object.assign({}, payload.modelSettings || {}, {
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            modelName: config.textModelName,
            reasoningEffort: config.reasoningEffort
          });
        }
        if (shouldPatchImage) {
          payload.provider = "dmxapi";
          payload.apiKey = config.apiKey;
          payload.apiBaseUrl = config.baseUrl;
          payload.model = normalizeDmxImageModelName(config.imageProvider, config.imageModelName);
          payload.dmxProvider = config.imageProvider;
        }
        nextInit.body = JSON.stringify(payload);
        nextInit.headers = Object.assign({ "Content-Type": "application/json" }, nextInit.headers || {});
        return nativeFetch(input, nextInit);
      } catch {
        return nativeFetch(input, init);
      }
    };
  }

  function patchLessonAbortFetch() {
    if (typeof window.fetch !== "function" || window.fetch.__peacLessonAbortPatched) return;
    var currentFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : input && input.url ? input.url : "";
      var shouldTrack = typeof url === "string" && (url.indexOf("/api/models/group") !== -1 || url.indexOf("/api/models/chat") !== -1);
      if (!shouldTrack || init && init.signal) return currentFetch(input, init);
      var controller = new AbortController();
      var now = Date.now();
      if (!lessonProgressStartedAt) lessonProgressStartedAt = now;
      lessonProgressLastUpdatedAt = now;
      scheduleLessonProgressTick();
      lessonAbortControllers.push(controller);
      var nextInit = Object.assign({}, init || {}, { signal: controller.signal });
      return currentFetch(input, nextInit).finally(function () {
        lessonProgressLastUpdatedAt = Date.now();
        lessonAbortControllers = lessonAbortControllers.filter(function (item) { return item !== controller; });
        scheduleLessonProgressTick();
      });
    };
    window.fetch.__peacLessonAbortPatched = true;
  }

  function abortLessonGeneration() {
    lessonAbortControllers.forEach(function (controller) {
      try { controller.abort(); } catch (error) {}
    });
    lessonAbortControllers = [];
  }

  function formatDuration(ms) {
    var total = Math.max(0, Math.floor((ms || 0) / 1000));
    var minutes = Math.floor(total / 60);
    var seconds = total % 60;
    return minutes + ":" + String(seconds).padStart(2, "0");
  }

  function lessonProgressPercent(section) {
    var percentText = Array.from(section.querySelectorAll("span")).map(textOf).find(function (text) {
      return /^\d{1,3}%$/.test(text.trim());
    });
    if (percentText) return Math.max(0, Math.min(100, parseInt(percentText, 10) || 0));
    var filled = Array.from(section.querySelectorAll("div")).find(function (node) {
      var width = node.getAttribute("style") || "";
      return width.indexOf("width:") !== -1 && width.indexOf("%") !== -1;
    });
    var match = filled ? (filled.getAttribute("style") || "").match(/width:\s*(\d+(?:\.\d+)?)%/) : null;
    return match ? Math.max(0, Math.min(100, Number(match[1]) || 0)) : 0;
  }

  function scheduleLessonProgressTick() {
    if (lessonProgressTimer) return;
    lessonProgressTimer = window.setInterval(function () {
      var lesson = panelContent("lesson");
      var progressCard = lesson && lesson.querySelector("[data-peac-stable-progress]");
      if (lesson && progressCard) updateStableLessonProgress(progressCard, lesson);
      if (!lessonAbortControllers.length && lessonProgressTimer) {
        window.clearInterval(lessonProgressTimer);
        lessonProgressTimer = 0;
      }
    }, 1000);
  }

  function updateStableLessonProgress(progressCard, section) {
    var percent = lessonProgressPercent(section);
    var bar = progressCard.querySelector("[data-peac-progress-bar]");
    var phase = progressCard.querySelector("[data-peac-progress-phase]");
    var elapsed = progressCard.querySelector("[data-peac-elapsed]");
    var updated = progressCard.querySelector("[data-peac-updated]");
    if (bar) bar.style.width = percent + "%";
    var statusText = "等待开始";
    if (lessonAbortControllers.length) statusText = "正在备课...";
    else if (percent >= 100) statusText = "备课完成";
    else if (lessonProgressStartedAt) statusText = "已暂停或等待下一步";
    if (phase) phase.textContent = statusText;
    var now = Date.now();
    if (elapsed) elapsed.textContent = formatDuration(lessonProgressStartedAt ? now - lessonProgressStartedAt : 0);
    if (updated) updated.textContent = formatDuration(lessonProgressLastUpdatedAt ? now - lessonProgressLastUpdatedAt : 0);
  }

  function readDmxForm(card) {
    return writeDmxConfig({
      textEnabled: !!(card.querySelector('[data-dmx-field="textEnabled"]') || {}).checked,
      imageEnabled: !!(card.querySelector('[data-dmx-field="imageEnabled"]') || {}).checked,
      apiKey: (card.querySelector('[data-dmx-field="apiKey"]') || {}).value || "",
      baseUrl: (card.querySelector('[data-dmx-field="baseUrl"]') || {}).value || "",
      textProvider: (card.querySelector('[data-dmx-field="textProvider"]') || {}).value || "",
      textModelName: (card.querySelector('[data-dmx-field="textModelName"]') || {}).value || "",
      imageProvider: (card.querySelector('[data-dmx-field="imageProvider"]') || {}).value || "",
      imageModelName: (card.querySelector('[data-dmx-field="imageModelName"]') || {}).value || "",
      reasoningEffort: (card.querySelector('[data-dmx-field="reasoningEffort"]') || {}).value || ""
    });
  }

  function setDmxStatus(card, message, tone) {
    var status = card && card.querySelector("[data-dmx-status]");
    if (!status) return;
    setText(status, message);
    status.dataset.tone = tone || "muted";
  }

  function fillDmxOptions(select, items, value) {
    if (!select) return;
    select.innerHTML = "";
    items.forEach(function (item) {
      select.appendChild(new Option(item[1], item[0]));
    });
    select.value = items.some(function (item) { return item[0] === value; }) ? value : items[0][0];
  }

  function fillDmxModelSelect(card, type, value) {
    var providerField = card.querySelector('[data-dmx-field="' + type + 'Provider"]');
    var modelField = card.querySelector('[data-dmx-field="' + type + 'ModelName"]');
    var catalog = type === "image" ? DMX_IMAGE_MODELS : DMX_TEXT_MODELS;
    var provider = providerField && catalog[providerField.value] ? providerField.value : Object.keys(catalog)[0];
    fillDmxOptions(modelField, catalog[provider], value);
  }

  function fillDmxProviderSelect(select, catalog, value) {
    if (!select) return;
    select.innerHTML = "";
    Object.keys(catalog).forEach(function (provider) {
      select.appendChild(new Option(provider, provider));
    });
    select.value = catalog[value] ? value : Object.keys(catalog)[0];
  }

  function ensureDmxapiConfig() {
    var settings = panel("settings");
    if (!settings || settings.querySelector("[data-dmxapi-card]")) return;
    var config = readDmxConfig();
    var card = el("section", "peac-dmxapi-card peac-native-card");
    card.setAttribute("data-dmxapi-card", "");
    card.innerHTML = [
      '<div class="peac-dmxapi-head"><div><p class="peac-kicker">DMXAPI 中转线路</p>',
      '<h2>用一个 API Key 调用文字与生图模型</h2>',
      '<p>统一格式：文字走 /v1/chat/completions，常规生图走 /v1/images/generations；万相 2.7 Image 会自动走 /v1/responses。两条线路可分别启用，关闭时原有入口保持不变。</p></div>',
      '<div class="peac-dmxapi-switches"><label class="peac-dmxapi-toggle"><input type="checkbox" data-dmx-field="textEnabled">备课文字走中转</label><label class="peac-dmxapi-toggle"><input type="checkbox" data-dmx-field="imageEnabled">课件图片走中转</label></div></div>',
      '<div class="peac-dmxapi-grid">',
      '<label>API Key<input type="password" data-dmx-field="apiKey" placeholder="sk-..."></label>',
      '<label>Base URL<input type="url" data-dmx-field="baseUrl" placeholder="https://www.dmxapi.cn/v1"></label>',
      '<label>思考强度<select data-dmx-field="reasoningEffort"><option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="xhigh">超高</option></select></label>',
      '</div>',
      '<div class="peac-dmxapi-grid peac-dmxapi-model-grid">',
      '<label>备课供应商<select data-dmx-field="textProvider"></select></label>',
      '<label>备课模型<select data-dmx-field="textModelName"></select></label>',
      '<label>生图供应商<select data-dmx-field="imageProvider"></select></label>',
      '<label>生图模型<select data-dmx-field="imageModelName"></select></label>',
      '</div>',
      '<div class="peac-dmxapi-actions"><button type="button" data-dmx-save>保存配置</button><button type="button" data-dmx-test>测试文本对话</button></div>',
      '<p class="peac-dmxapi-status" data-dmx-status data-tone="muted">保存并启用后，备课文字或课件图片会按你的开关走 DMXAPI 中转；Authorization 会按平台文档直接使用 sk-... 令牌。</p>'
    ].join("");
    card.querySelector('[data-dmx-field="textEnabled"]').checked = config.textEnabled;
    card.querySelector('[data-dmx-field="imageEnabled"]').checked = config.imageEnabled;
    card.querySelector('[data-dmx-field="apiKey"]').value = config.apiKey;
    card.querySelector('[data-dmx-field="baseUrl"]').value = config.baseUrl;
    card.querySelector('[data-dmx-field="reasoningEffort"]').value = config.reasoningEffort;
    fillDmxProviderSelect(card.querySelector('[data-dmx-field="textProvider"]'), DMX_TEXT_MODELS, config.textProvider);
    fillDmxProviderSelect(card.querySelector('[data-dmx-field="imageProvider"]'), DMX_IMAGE_MODELS, config.imageProvider);
    fillDmxModelSelect(card, "text", config.textModelName);
    fillDmxModelSelect(card, "image", config.imageModelName);
    card.addEventListener("click", async function (event) {
      if (event.target.closest("[data-dmx-save]")) {
        var saved = readDmxForm(card);
        var enabledText = [];
        if (saved.textEnabled) enabledText.push("备课：" + saved.textModelName);
        if (saved.imageEnabled) enabledText.push("生图：" + saved.imageModelName);
        setDmxStatus(card, enabledText.length ? "已启用 DMXAPI 中转：" + enabledText.join("；") : "已保存配置，但当前未启用中转线路。", "ok");
        refreshStatusPanel();
      }
      if (event.target.closest("[data-dmx-test]")) {
        var button = event.target.closest("[data-dmx-test]");
        var savedConfig = readDmxForm(card);
        if (!savedConfig.apiKey) {
          setDmxStatus(card, "请先填写 DMXAPI Key。", "error");
          return;
        }
        button.disabled = true;
        setDmxStatus(card, "正在测试 DMXAPI 文本对话...", "muted");
        try {
          var response = await fetch("/api/models/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              input: "请只回复：DMXAPI 连接正常",
              modelType: "domestic",
              modelSettings: {
                apiKey: savedConfig.apiKey,
                baseUrl: savedConfig.baseUrl,
                modelName: savedConfig.textModelName,
                reasoningEffort: savedConfig.reasoningEffort
              }
            })
          });
          var data = await response.json().catch(function () { return {}; });
          if (!response.ok) throw new Error(data.error || "测试失败");
          setDmxStatus(card, "测试成功：" + String(data.content || "").slice(0, 80), "ok");
        } catch (error) {
          setDmxStatus(card, error && error.message ? error.message : "测试失败，请检查 Key、Base URL 和模型名。", "error");
        } finally {
          button.disabled = false;
        }
      }
    });
    card.addEventListener("change", function (event) {
      if (event.target.matches('[data-dmx-field="textProvider"]')) {
        fillDmxModelSelect(card, "text");
      }
      if (event.target.matches('[data-dmx-field="imageProvider"]')) {
        fillDmxModelSelect(card, "image");
      }
      if (event.target.matches('[data-dmx-field="textEnabled"], [data-dmx-field="imageEnabled"]')) {
        var saved = readDmxForm(card);
        setDmxStatus(card, saved.textEnabled || saved.imageEnabled ? "已保存。下一次对应任务会按开关走 DMXAPI 中转。" : "已关闭。下一次生成会继续使用原有模型入口。", saved.textEnabled || saved.imageEnabled ? "ok" : "muted");
        refreshStatusPanel();
      }
    });
    settings.appendChild(card);
  }

  function applyDmxTextToLessonControls() {
    var lessonPanel = panel("lesson");
    if (!lessonPanel) return;
    var config = readDmxConfig();
    var dmxReady = !!(config && config.textEnabled && config.apiKey && String(config.apiKey).trim());
    var advanced = lessonPanel.querySelector(".peac-advanced");
    var notice = lessonPanel.querySelector("[data-peac-dmx-lesson-notice]");
    if (!notice && advanced) {
      notice = el("div", "peac-dmx-lesson-notice");
      notice.setAttribute("data-peac-dmx-lesson-notice", "true");
      advanced.appendChild(notice);
    } else if (notice && advanced && notice.parentElement !== advanced) {
      advanced.appendChild(notice);
    }
    if (notice) {
      notice.hidden = !dmxReady;
      if (dmxReady) {
        var providerName = config.textProviderName || config.textProvider || "DMXAPI";
        var modelName = config.textModelName || "gpt-5.5";
        setText(notice, "DMXAPI 备课中转已启用：当前备课会使用 " + providerName + " / " + modelName + "。原下拉框仅作兼容显示，不需要再单独填写 DeepSeek Key。");
      }
    }
    refreshLessonConfigHint(lessonPanel);
    var apiKeyInputs = Array.from(lessonPanel.querySelectorAll('input[type="password"], input[placeholder*="API Key"], input[aria-label*="API Key"]'));
    var apiKeyInput = apiKeyInputs.find(function (input) {
      var localText = textOf(input.closest("label") || input.parentElement || input);
      var placeholder = input.getAttribute("placeholder") || "";
      return (localText + " " + placeholder).toLowerCase().indexOf("api key") !== -1;
    }) || apiKeyInputs[0];
    setDmxLegacyTextControls(lessonPanel, dmxReady, apiKeyInput);
    if (!dmxReady) return;
    if (apiKeyInput && apiKeyInput.value !== config.apiKey) {
      setNativeValue(apiKeyInput, config.apiKey);
    }
    if (apiKeyInput && apiKeyInput.dataset.peacDmxLessonRetry !== "done") {
      apiKeyInput.dataset.peacDmxLessonRetry = "done";
      window.setTimeout(function () {
        if (apiKeyInput.value !== config.apiKey) setNativeValue(apiKeyInput, config.apiKey);
      }, 120);
    }
  }

  function setDmxLegacyTextControls(lessonPanel, locked, apiKeyInput) {
    var scope = apiKeyInput && apiKeyInput.parentElement ? apiKeyInput.parentElement : lessonPanel.querySelector(".peac-advanced");
    if (!scope) return;
    Array.from(scope.querySelectorAll("select, button")).forEach(function (control) {
      if (locked) {
        if (control.dataset.peacDmxWasDisabled === undefined) control.dataset.peacDmxWasDisabled = String(control.disabled);
        control.disabled = true;
      } else if (control.dataset.peacDmxWasDisabled !== undefined) {
        control.disabled = control.dataset.peacDmxWasDisabled === "true";
        delete control.dataset.peacDmxWasDisabled;
      }
    });
    if (!apiKeyInput) return;
    if (locked) {
      if (apiKeyInput.dataset.peacDmxWasReadonly === undefined) apiKeyInput.dataset.peacDmxWasReadonly = String(apiKeyInput.readOnly);
      apiKeyInput.readOnly = true;
    } else if (apiKeyInput.dataset.peacDmxWasReadonly !== undefined) {
      apiKeyInput.readOnly = apiKeyInput.dataset.peacDmxWasReadonly === "true";
      delete apiKeyInput.dataset.peacDmxWasReadonly;
    }
  }

  function setDmxLegacyImageControls(locked, controls) {
    [controls.provider, controls.model].forEach(function (control) {
      if (!control) return;
      if (locked) {
        if (control.dataset.peacDmxImageWasDisabled === undefined) control.dataset.peacDmxImageWasDisabled = String(control.disabled);
        control.disabled = true;
      } else if (control.dataset.peacDmxImageWasDisabled !== undefined) {
        control.disabled = control.dataset.peacDmxImageWasDisabled === "true";
        delete control.dataset.peacDmxImageWasDisabled;
      }
    });
    [controls.apiKey, controls.apiBaseUrl, controls.proxyUrl].forEach(function (control) {
      if (!control) return;
      if (locked) {
        if (control.dataset.peacDmxImageWasReadonly === undefined) control.dataset.peacDmxImageWasReadonly = String(control.readOnly);
        if (control.dataset.peacDmxImagePreviousValue === undefined) control.dataset.peacDmxImagePreviousValue = control.value || "";
        control.readOnly = true;
      } else if (control.dataset.peacDmxImageWasReadonly !== undefined) {
        control.readOnly = control.dataset.peacDmxImageWasReadonly === "true";
        if (control.dataset.peacDmxImagePreviousValue !== undefined && control.value !== control.dataset.peacDmxImagePreviousValue) {
          setNativeValue(control, control.dataset.peacDmxImagePreviousValue);
        }
        delete control.dataset.peacDmxImageWasReadonly;
        delete control.dataset.peacDmxImagePreviousValue;
      }
    });
  }

  function applyDmxImageToImageControls() {
    var imagePanel = panel("images");
    if (!imagePanel) return;
    var config = readDmxConfig();
    var dmxReady = !!(config && config.imageEnabled && config.apiKey && String(config.apiKey).trim());
    var controls = imageConfigControls();
    var advanced = imagePanel.querySelector(".peac-image-advanced");
    var guide = imagePanel.querySelector(".peac-image-guide");
    var anchor = advanced || guide;
    var notice = imagePanel.querySelector("[data-peac-dmx-image-notice]");
    if (!notice && anchor) {
      notice = el("div", "peac-dmx-image-notice");
      notice.setAttribute("data-peac-dmx-image-notice", "true");
      if (advanced) advanced.appendChild(notice);
      else anchor.insertAdjacentElement("afterend", notice);
    } else if (notice && advanced && notice.parentElement !== advanced) {
      advanced.appendChild(notice);
    }
    if (notice) {
      notice.hidden = !dmxReady;
      if (dmxReady) {
        var providerName = config.imageProvider || "DMXAPI";
        var modelName = config.imageModelName || "gpt-image-2";
        setText(notice, "DMXAPI 生图中转已启用：当前课件图片会使用 " + providerName + " / " + modelName + "。原 Google API 字段仅作兼容校验显示，不需要再单独填写 Google Key。");
      }
    }
    setDmxLegacyImageControls(dmxReady, controls);
    if (!dmxReady) return;
    function applyFields() {
      var current = imageConfigControls();
      if (current.apiKey && current.apiKey.value !== config.apiKey) setNativeValue(current.apiKey, config.apiKey);
      if (current.apiBaseUrl && current.apiBaseUrl.value !== config.baseUrl) setNativeValue(current.apiBaseUrl, config.baseUrl);
      if (current.proxyUrl && current.proxyUrl.value) setNativeValue(current.proxyUrl, "");
      setDmxLegacyImageControls(true, current);
      refreshStatusPanel();
    }
    applyFields();
    if (imagePanel.dataset.peacDmxImageRetry !== config.imageModelName) {
      imagePanel.dataset.peacDmxImageRetry = config.imageModelName;
      window.setTimeout(applyFields, 120);
      window.setTimeout(applyFields, 320);
    }
  }

  function dmxImageConfigReady(config) {
    return !!(config && config.imageEnabled && config.apiKey && String(config.apiKey).trim());
  }

  function syncDmxImageRuntimeControls(config) {
    if (!dmxImageConfigReady(config)) return null;
    var controls = imageConfigControls();
    if (controls.apiKey) setNativeValue(controls.apiKey, config.apiKey);
    if (controls.apiBaseUrl) setNativeValue(controls.apiBaseUrl, config.baseUrl);
    if (controls.proxyUrl && controls.proxyUrl.value) setNativeValue(controls.proxyUrl, "");
    setDmxLegacyImageControls(true, controls);
    refreshStatusPanel();
    return controls;
  }

  function installDmxImageGenerateGuard() {
    if (document.documentElement.dataset.peacDmxImageGuard === "true") return;
    document.documentElement.dataset.peacDmxImageGuard = "true";
    document.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest("button") : null;
      if (!button || !button.closest('[data-peac-panel="images"]')) return;
      var label = textOf(button);
      var isGenerateAction = button.classList.contains("peac-image-generate-button") || label.indexOf("一键生成图片") !== -1 || label.indexOf("重新生成") !== -1;
      if (!isGenerateAction) return;
      var config = readDmxConfig();
      if (!dmxImageConfigReady(config)) return;
      syncDmxImageRuntimeControls(config);
      if (button.dataset.peacDmxImageSynced === "true") {
        delete button.dataset.peacDmxImageSynced;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      button.dataset.peacDmxImageSynced = "true";
      window.setTimeout(function () {
        button.click();
      }, 120);
    }, true);
  }

  function allDirectContent(main) {
    return Array.from(main.children).filter(function (node) {
      return node.tagName !== "HEADER" && !node.classList.contains("peac-tabs") && !node.classList.contains("peac-tab-shell") && !node.classList.contains("peac-status-panel");
    });
  }

  function sectionHas(node) {
    var text = textOf(node);
    return Array.prototype.slice.call(arguments, 1).every(function (part) {
      return text.indexOf(part) !== -1;
    });
  }

  function findLessonSection(main) {
    return allDirectContent(main).find(function (node) {
      return sectionHas(node, "开始备课") && sectionHas(node, "最终成果");
    }) || document.querySelector('[data-peac-panel="lesson"]');
  }

  function findImagesSection(main) {
    return allDirectContent(main).find(function (node) {
      return sectionHas(node, "课件图片") && sectionHas(node, "图片任务");
    }) || document.querySelector('[data-peac-panel="images"]');
  }

  function findResourceSection(main) {
    return allDirectContent(main).find(function (node) {
      return sectionHas(node, "校本资料库") && sectionHas(node, "后台设置与进度");
    });
  }

  function originalSettingsButton() {
    return document.querySelector("header .peac-original-settings") || Array.from(document.querySelectorAll("header button")).find(function (button) {
      var text = textOf(button);
      return text.indexOf("后台") !== -1 || text.indexOf("进度") !== -1 || text.indexOf("设置") !== -1 || text.indexOf("收起") !== -1;
    });
  }

  function dispatchRealClick(button) {
    if (!button) return false;
    try {
      button.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      }));
      return true;
    } catch {
      button.click();
      return true;
    }
  }

  function isRealLibraryVisible() {
    return !!document.querySelector('[data-peac-panel="library"] .peac-library-section');
  }

  function markResourcePanelLoading(target) {
    var targetPanel = panel(target || activeTab);
    if (!targetPanel) return;
    var isLibrary = targetPanel.dataset.peacPanel === "library";
    var isSettings = targetPanel.dataset.peacPanel === "settings";
    if (isLibrary && isRealLibraryVisible()) return;
    if (isSettings && targetPanel.querySelector(".peac-dmxapi-card, .peac-native-card:not(.peac-empty)")) return;
    var card = targetPanel.querySelector(".peac-empty");
    if (!card) return;
    card.classList.add("is-loading");
    var copy = card.querySelector("p");
    if (copy) {
      copy.textContent = isLibrary
        ? "正在打开资料。如果没有马上出现，请稍等片刻；系统会把后台中的本地资料显示到这里。"
        : "正在打开设置与后台进度。";
    }
  }

  function findResourceCardByTitle(titleText, siblingText) {
    var title = Array.from(document.querySelectorAll("h2, h3, h4, div")).find(function (node) {
      return textOf(node).trim() === titleText && !node.closest(".peac-tab-shell") && !node.closest(".peac-status-panel");
    });
    if (!title) return null;
    var card = title.closest("section, article, aside, div");
    while (card && card.parentElement && card.parentElement !== document.body) {
      var siblings = Array.from(card.parentElement.children);
      if (siblings.some(function (node) {
        return node !== card && textOf(node).indexOf(siblingText) !== -1;
      })) {
        return card;
      }
      if (card.parentElement.tagName === "MAIN") return card;
      card = card.parentElement;
    }
    return null;
  }

  function ensureShell(main) {
    var tabs = document.querySelector(".peac-tabs");
    if (!tabs) {
      tabs = el("nav", "peac-tabs");
      tabs.setAttribute("aria-label", "主要功能");
      tabs.appendChild(el("div", "peac-nav-head", '<strong>PEAC 工作台</strong><span>按备课流程选择入口</span>'));
      navTabs().forEach(function (tab) {
        var button = el("button", "peac-tab");
        button.type = "button";
        button.dataset.peacTab = tab.id;
        button.textContent = tab.label;
        button.addEventListener("click", function () {
          setActiveTab(tab.id);
        });
        tabs.appendChild(button);
      });
      tabs.appendChild(el("div", "peac-nav-note", "先选任务入口；模型、密钥和对比放到高级里。"));
      main.querySelector("header").insertAdjacentElement("afterend", tabs);
    }

    var shell = document.querySelector(".peac-tab-shell");
    if (!shell) {
      shell = el("div", "peac-tab-shell");
      TABS.filter(function (tab) { return VIRTUAL_PANELS.indexOf(tab.id) !== -1; }).forEach(function (tab) {
        var panel = el("section", "peac-tab-panel");
        panel.dataset.peacPanel = tab.id;
        panel.setAttribute("aria-label", tab.label);
        shell.appendChild(panel);
      });
      tabs.insertAdjacentElement("afterend", shell);
    }
    Array.from(shell.querySelectorAll('[data-peac-panel="lesson"], [data-peac-panel="images"]')).forEach(function (node) {
      node.remove();
    });
    return shell;
  }

  function ensureStatusPanel(main) {
    var status = document.querySelector(".peac-status-panel");
    if (!status) {
      status = el("aside", "peac-status-panel");
      status.innerHTML = [
        '<section class="peac-status-card">',
        '<p class="peac-status-eyebrow">当前任务</p>',
        '<h2 data-status-title>工作台首页</h2>',
        '<p data-status-copy>按手头资料选择入口，系统会把下一步留在当前页面里。</p>',
        '</section>',
        '<section class="peac-status-card">',
        '<p class="peac-status-eyebrow">配置摘要</p>',
        '<div class="peac-status-list">',
        '<div><span>文字模型</span><strong data-status-text-model>页面设置</strong></div>',
        '<div><span>图片模型</span><strong data-status-image-model>课件图片页</strong></div>',
        '<div><span>演示生成</span><strong data-status-demo>可在图片页切换</strong></div>',
        '</div>',
        '</section>',
        '<section class="peac-status-card">',
        '<p class="peac-status-eyebrow">快捷操作</p>',
        '<div class="peac-status-actions">',
        '<button type="button" data-status-jump="lesson">我要备一节课</button>',
        '<button type="button" data-status-jump="images">我要做课件图</button>',
        '<button type="button" data-status-jump="export">查看成果</button>',
        '</div>',
        '</section>',
        '<section class="peac-status-card peac-status-note">',
        '<p>常用流程优先展示；API、代理和 Base URL 默认收起，只有排查或换模型时再打开。</p>',
        '</section>'
      ].join("");
      status.addEventListener("click", function (event) {
        var button = event.target.closest("[data-status-jump]");
        if (button) setActiveTab(button.dataset.statusJump);
      });
      main.appendChild(status);
    }
    return status;
  }

  function refreshStatusPanel() {
    var status = document.querySelector(".peac-status-panel");
    if (!status) return;
    var info = {
      home: ["工作台首页", "先选择今天的起点：备一节课，或把已有脚本做成课件图。"],
      lesson: ["备课", "填写课时信息后生成教案、检测、作业和 PPT 脚本。"],
      images: ["课件图", "放入 PPT 脚本，解析页面，生成图片包或成品 PPTX。"],
      compare: ["模型对比", "先用同一页脚本横向比较，再把合适模型设为整套通道。"],
      library: ["资料", "上传本次要参考的教材、模板、错题或班情资料。"],
      export: ["成果", "按当前进度找到可下载的资料包、图片包或 PPTX。"],
      settings: ["设置", "集中管理模型、密钥、网络和高级调试项。"]
    }[activeTab] || ["工作台", "选择一个入口继续。"];
    var title = status.querySelector("[data-status-title]");
    var copy = status.querySelector("[data-status-copy]");
    setText(title, info[0]);
    setText(copy, info[1]);

    var textModel = status.querySelector("[data-status-text-model]");
    var imageModel = status.querySelector("[data-status-image-model]");
    var demo = status.querySelector("[data-status-demo]");
    var modelInput = document.querySelector('[data-peac-panel="settings"] input[type="text"]');
    var imageProvider = document.querySelector('[data-peac-panel="images"] select');
    var demoInput = Array.from(document.querySelectorAll('[data-peac-panel="images"] input[type="checkbox"]')).find(function (node) {
      return textOf(node.parentNode).indexOf("演示") !== -1 || textOf(node.parentNode).indexOf("生成") !== -1;
    });
    var dmxConfig = readDmxConfig();
    setText(textModel, dmxConfig.textEnabled ? ("DMXAPI / " + dmxConfig.textModelName) : (modelInput && modelInput.value ? modelInput.value : "页面设置"));
    setText(imageModel, dmxConfig.imageEnabled ? ("DMXAPI / " + dmxConfig.imageModelName) : (imageProvider && imageProvider.options[imageProvider.selectedIndex] ? imageProvider.options[imageProvider.selectedIndex].textContent : "课件图片页"));
    setText(demo, demoInput ? (demoInput.checked ? "已开启" : "已关闭") : "可在图片页切换");
  }

  function panel(id) {
    return document.querySelector('[data-peac-panel="' + id + '"]');
  }

  function markNativePanel(node, id) {
    if (!node) return null;
    var tab = TABS.find(function (item) { return item.id === id; });
    node.dataset.peacPanel = id;
    node.setAttribute("aria-label", tab ? tab.label : id);
    node.classList.add("peac-tab-panel", "peac-native-react-panel");
    return node;
  }

  function panelContent(id) {
    var node = panel(id);
    if (!node) return null;
    return node.classList.contains("peac-native-react-panel") ? node : node.querySelector("section");
  }

  function setActiveTab(id) {
    activeTab = TABS.some(function (tab) { return tab.id === id; }) ? id : "home";
    window.localStorage.setItem("peac-active-tab-v2", activeTab);
    if (window.location.hash !== "#" + activeTab) {
      window.history.replaceState(null, "", "#" + activeTab);
    }
    applyActiveTab();
    if (id === "library" || id === "settings") revealResourcePanels(id);
    if (id === "compare") refreshCompareSlides();
  }

  function applyActiveTab() {
    document.body.dataset.peacActiveTab = activeTab;
    Array.from(document.querySelectorAll(".peac-tab")).forEach(function (button) {
      button.setAttribute("aria-selected", String(button.dataset.peacTab === activeTab));
    });
    Array.from(document.querySelectorAll(".peac-tab-panel")).forEach(function (node) {
      node.classList.toggle("is-active", node.dataset.peacPanel === activeTab);
    });
    refreshStatusPanel();
  }

  function revealResourcePanels(target) {
    var button = originalSettingsButton();
    var needsLibrary = !document.querySelector('[data-peac-panel="library"] .peac-native-card');
    var needsSettings = !document.querySelector('[data-peac-panel="settings"] .peac-native-card');
    var buttonText = textOf(button);
    var looksOpen = buttonText.indexOf("收起") !== -1;
    if (target === "library" || target === "settings") markResourcePanelLoading(target);
    if (button && (needsLibrary || needsSettings || target === "library" || target === "settings") && !looksOpen) {
      dispatchRealClick(button);
    }
    [0, 80, 180, 360, 700, 1100].forEach(function (delay) {
      window.setTimeout(function () {
        var main = document.querySelector("main");
        moveResourceCards(main ? findResourceSection(main) : null);
        schedule();
      }, delay);
    });
  }

  function ensureHome() {
    var home = panel("home");
    if (!home || home.dataset.ready === "true") return;
    home.dataset.ready = "true";
    home.classList.add("peac-home-panel");
    home.innerHTML = [
      '<section class="peac-hero">',
      '<div>',
      '<p class="peac-kicker">先选今天要完成的事</p>',
      '<h2>今天从哪里开始？</h2>',
      '<p>不用先研究全部功能。选择一个入口，后面的设置、导出和高级能力会在需要时出现。</p>',
      '</div>',
      '<div class="peac-hero-steps"><span>选任务</span><span>填必要信息</span><span>生成</span><span>下载成果</span></div>',
      '</section>',
      '<section class="peac-choice-grid">',
      '<article class="peac-choice is-primary">',
      '<div class="peac-choice-num">常用入口</div>',
      '<h3>我要备一节课</h3>',
      '<p>从教材、年级、单元和课型开始，生成教案、检测、作业和 PPT 脚本。</p>',
      '<div class="peac-choice-meta"><span>适合：常态课、公开课、集体备课初稿</span><strong>下一步：填写课时信息</strong></div>',
      '<button type="button" data-jump="lesson">我要备一节课</button>',
      '</article>',
      '<article class="peac-choice">',
      '<div class="peac-choice-num">快捷通道</div>',
      '<h3>我已有脚本，要做课件图</h3>',
      '<p>粘贴或上传逐页 PPT 脚本，解析后生成图片包或成品 PPTX。</p>',
      '<div class="peac-choice-meta"><span>适合：脚本已定，只差课堂画面</span><strong>下一步：放入 PPT 脚本</strong></div>',
      '<button type="button" data-jump="images">我已有脚本，要做课件图</button>',
      '</article>',
      '</section>',
      '<section class="peac-home-flow">',
      '<div><span>01</span><strong>填课时</strong><p>教材、年级、单元、课型先定下来。</p></div>',
      '<div><span>02</span><strong>生成资料</strong><p>得到可编辑教案、检测、作业和 PPT 脚本。</p></div>',
      '<div><span>03</span><strong>出课件图</strong><p>解析脚本，按页生成可投屏图片。</p></div>',
      '<div><span>04</span><strong>导出成品</strong><p>下载资料包、图片包或成品 PPTX。</p></div>',
      '</section>'
    ].join("");
    home.addEventListener("click", function (event) {
      var target = event.target.closest("[data-jump]");
      if (target) setActiveTab(target.dataset.jump);
    });
  }

  function ensureEmptyPanels() {
    var library = panel("library");
    if (library && !library.dataset.placeholder) {
      library.dataset.placeholder = "true";
      library.innerHTML = [
        '<section class="peac-empty">',
        '<h2>资料</h2>',
        '<p>还没有资料也可以直接备课；上传教材页、校本模板、错题记录或班情反馈后，生成结果会更贴近本班。</p>',
        '<button type="button" data-open-settings>上传或选择资料</button>',
        '</section>'
      ].join("");
    }
    var settings = panel("settings");
    if (settings && !settings.dataset.placeholder) {
      settings.dataset.placeholder = "true";
      settings.innerHTML = [
        '<section class="peac-empty">',
        '<h2>设置</h2>',
        '<p>这里集中管理模型与密钥、网络与代理、高级 Prompt 和调试信息。日常使用不用先看这里。</p>',
        '<button type="button" data-open-settings>打开设置</button>',
        '</section>'
      ].join("");
    }
    var exportPanel = panel("export");
    if (exportPanel && !exportPanel.dataset.ready) {
      exportPanel.dataset.ready = "true";
      exportPanel.innerHTML = [
        '<section class="peac-empty">',
        '<h2>成果与下载</h2>',
        '<p>生成完成后这里会提示可下载内容。当前如果还没有成果，可以先去备课或课件图页面继续。</p>',
        '<div class="peac-export-actions">',
        '<button type="button" data-jump-export="lesson">查看备课成果</button>',
        '<button type="button" data-jump-export="images">查看课件图成果</button>',
        '</div>',
        '</section>'
      ].join("");
      exportPanel.addEventListener("click", function (event) {
        var jump = event.target.closest("[data-jump-export]");
        if (jump) setActiveTab(jump.dataset.jumpExport);
      });
    }
    if (document.body.dataset.peacSettingsDelegate !== "true") {
      document.body.dataset.peacSettingsDelegate = "true";
      document.addEventListener("click", function (event) {
        var openButton = event.target.closest("[data-open-settings]");
        if (!openButton) return;
        event.preventDefault();
        event.stopPropagation();
        var owningPanel = openButton.closest("[data-peac-panel]");
        revealResourcePanels(owningPanel ? owningPanel.dataset.peacPanel : activeTab);
      });
    }
  }

  function enhanceHeader() {
    var header = document.querySelector("header");
    if (!header || header.dataset.peacEnhanced === "true") return;
    header.dataset.peacEnhanced = "true";
    document.title = "PEAC 小学英语智能备课工作台 " + PEAC_VERSION;
    var title = header.querySelector("h1");
    if (title) title.textContent = "PEAC 小学英语智能备课工作台";
    var intro = title && title.parentElement ? title.parentElement.querySelector("p") : null;
    if (intro) intro.textContent = "先选任务，再按页面提示生成和下载；模型与高级设置会在需要时出现。";
    if (title && !header.querySelector(".peac-version-badge")) {
      var badge = el("span", "peac-version-badge", PEAC_VERSION + " 测试版");
      title.insertAdjacentElement("afterend", badge);
    }
    if (!header.querySelector(".peac-top-guide")) {
      var search = el("div", "peac-top-guide", '<span>推荐流程</span><strong>备课 → 课件图 → 成果</strong>');
      var firstRow = title ? title.closest("div") : header.firstElementChild;
      if (firstRow) firstRow.insertAdjacentElement("afterend", search);
      else header.appendChild(search);
    }
    var button = originalSettingsButton();
    if (button) button.classList.add("peac-original-settings");
  }

  function updateLessonProgressCompact(progressCard) {
    if (!progressCard) return;
    var compact = progressCard.querySelector("[data-peac-progress-compact]");
    if (!compact) {
      compact = el("div", "peac-progress-compact");
      compact.setAttribute("data-peac-progress-compact", "true");
      progressCard.appendChild(compact);
      new MutationObserver(function () {
        updateLessonProgressCompact(progressCard);
      }).observe(progressCard, { childList: true, characterData: true, subtree: true });
    }
    var raw = textOf(progressCard).replace(/\s+/g, " ").trim();
    var timeMatch = raw.match(/本次已用时\s*([0-9:：.]+)/) || raw.match(/已用时\s*([0-9:：.]+)/);
    var updateMatch = raw.match(/上次更新\s*([0-9:：.]+)/);
    var elapsed = timeMatch ? timeMatch[1] : "0:00";
    var updated = updateMatch ? updateMatch[1] : "0:00";
    var key = elapsed + "|" + updated;
    if (compact.dataset.peacProgressKey !== key) {
      compact.dataset.peacProgressKey = key;
      compact.innerHTML = [
        '<div><span>本次已用时</span><strong>' + elapsed + '</strong></div>',
        '<div><span>上次更新</span><strong>' + updated + '</strong></div>'
      ].join("");
    }
  }

  function lessonTextModelConfigured(section) {
    var config = readDmxConfig();
    if (config && config.textEnabled && config.apiKey && String(config.apiKey).trim()) return true;
    var apiKeyInput = Array.from(section.querySelectorAll('input[type="password"], input[placeholder*="API Key"], input[aria-label*="API Key"]')).find(function (input) {
      var localText = textOf(input.closest("label") || input.parentElement || input);
      var placeholder = input.getAttribute("placeholder") || "";
      return (localText + " " + placeholder).toLowerCase().indexOf("api key") !== -1;
    });
    return !!(apiKeyInput && String(apiKeyInput.value || "").trim());
  }

  function refreshLessonConfigHint(section) {
    var hint = section.querySelector("[data-peac-lesson-config-hint]");
    if (!hint) return;
    hint.hidden = lessonTextModelConfigured(section);
  }

  function syncLessonResultAvailability(resultPanel) {
    if (!resultPanel) return;
    var groups = resultPanel.querySelector(".peac-lesson-download-groups");
    if (!groups) return;
    var realDownloadButtons = Array.from(groups.querySelectorAll("button")).filter(function (button) {
      return !button.classList.contains("peac-result-next");
    });
    var hasReadyDownload = realDownloadButtons.some(function (button) { return !button.disabled; });
    resultPanel.classList.toggle("peac-lesson-no-downloads", !hasReadyDownload);
  }

  function enhanceLesson(section) {
    if (!section || section.dataset.peacLessonEnhanced === "true") return;
    section.dataset.peacLessonEnhanced = "true";
    section.classList.add("peac-native-card", "peac-lesson-section");
    if (!section.querySelector(".peac-lesson-guide")) {
      var guide = el("div", "peac-lesson-guide");
      guide.innerHTML = [
        '<div>',
        '<p class="peac-kicker">备课</p>',
        '<h2>先填清课时信息，再生成可编辑备课资料。</h2>',
        '<p>老师只需要先确认教材、年级、单元和课型；模型、密钥和 Prompt 归入高级设置，默认不用打扰主流程。</p>',
        '</div>',
        '<div class="peac-guide-side"><div class="peac-step-row"><span>1 填课时信息</span><span>2 生成备课内容</span><span>3 下载或继续出图</span></div><p>生成完成后，可先下载资料，也可直接带入课件图片页。</p></div>'
      ].join("");
      section.insertBefore(guide, section.firstElementChild);
    }
    var startTitle = Array.from(section.querySelectorAll("h2")).find(function (h2) {
      return textOf(h2).indexOf("开始备课") !== -1;
    });
    if (startTitle) startTitle.textContent = "填写备课任务";
    var apiCard = Array.from(section.querySelectorAll("h3")).find(function (h3) {
      return textOf(h3).indexOf("API 配置") !== -1;
    });
    if (apiCard) {
      var box = apiCard.closest("div");
      if (box && !box.closest("details")) {
        var details = el("details", "peac-advanced");
        details.innerHTML = '<summary>模型与密钥（需要时再打开）</summary>';
        box.parentNode.insertBefore(details, box);
        details.appendChild(box);
      }
    }
    Array.from(section.querySelectorAll(".peac-advanced")).forEach(function (details) {
      details.classList.add("peac-lesson-helper");
      var summary = details.querySelector("summary");
      if (summary && textOf(summary).indexOf("通常不用改") === -1) {
        summary.textContent = "模型与密钥（需要时再打开）";
      }
    });
    var templateButtons = Array.from(section.querySelectorAll("button")).filter(function (button) {
      return textOf(button).indexOf("模板") !== -1;
    });
    if (templateButtons.length) {
      var templateRow = templateButtons[0].closest("div");
      if (templateRow && !templateRow.closest("details")) {
        var templateDetails = el("details", "peac-lesson-helper peac-template-helper");
        templateDetails.innerHTML = '<summary>课型模板（可选）</summary>';
        templateRow.parentNode.insertBefore(templateDetails, templateRow);
        templateDetails.appendChild(templateRow);
      }
    }
    Array.from(section.querySelectorAll("details")).forEach(function (details) {
      var summary = details.querySelector("summary");
      if (summary && textOf(summary).indexOf("初始 Prompt") !== -1) {
        details.classList.add("peac-lesson-helper", "peac-prompt-helper");
        summary.textContent = "高级 Prompt / 调试（通常不用改）";
      }
    });
    var startButton = Array.from(section.querySelectorAll("button")).find(function (button) {
      return textOf(button) === "开始备课";
    });
    if (startButton) {
      startButton.textContent = "生成备课内容";
      startButton.classList.add("peac-lesson-primary-action");
      var firstHelper = section.querySelector(".peac-template-helper, .peac-advanced, .peac-prompt-helper");
      if (firstHelper && firstHelper.parentElement && startButton.parentElement !== firstHelper.parentElement) {
        firstHelper.parentElement.insertBefore(startButton, firstHelper);
      } else if (firstHelper && firstHelper.parentElement) {
        firstHelper.parentElement.insertBefore(startButton, firstHelper);
      }
      if (!section.querySelector("[data-peac-lesson-config-hint]")) {
        var configHint = el("div", "peac-lesson-config-hint");
        configHint.setAttribute("data-peac-lesson-config-hint", "true");
        configHint.innerHTML = '<span>还没有配置文字模型时，先到设置里填写密钥；配置好后回到这里生成。</span><button type="button">去设置</button>';
        configHint.querySelector("button").addEventListener("click", function () { setActiveTab("settings"); });
        startButton.insertAdjacentElement("afterend", configHint);
      }
      refreshLessonConfigHint(section);
      Array.from(section.querySelectorAll('input[type="password"], input[placeholder*="API Key"], input[aria-label*="API Key"]')).forEach(function (input) {
        if (input.dataset.peacLessonHintBound === "true") return;
        input.dataset.peacLessonHintBound = "true";
        input.addEventListener("input", function () { refreshLessonConfigHint(section); });
        input.addEventListener("change", function () { refreshLessonConfigHint(section); });
      });
    }
    var resultTitle = Array.from(section.querySelectorAll("h2")).find(function (h2) {
      return textOf(h2).indexOf("最终成果") !== -1;
    });
    if (resultTitle) {
      var resultPanel = resultTitle.closest("aside") || Array.from(section.children).find(function (child) {
        return child.contains(resultTitle) && textOf(child).indexOf("当前进度") !== -1;
      }) || resultTitle.parentElement;
      if (resultPanel) {
        resultPanel.classList.add("peac-lesson-results");
        resultTitle.textContent = "生成结果";
        var resultIntro = resultTitle.parentElement ? resultTitle.parentElement.querySelector("p") : null;
        if (resultIntro) resultIntro.textContent = "生成完成后，在这里下载资料，或继续生成课件图片。";
        var resultHead = resultTitle.parentElement && resultTitle.parentElement.parentElement ? resultTitle.parentElement.parentElement : resultTitle.closest("div");
        if (resultHead) resultHead.classList.add("peac-lesson-results-head");
        var statusPill = resultHead ? Array.from(resultHead.children).find(function (node) {
          return node.tagName === "SPAN" && textOf(node).trim();
        }) : null;
        var stateRow = resultPanel.querySelector(".peac-result-state-row");
        if (!stateRow) {
          stateRow = el("div", "peac-result-state-row");
          if (resultHead) resultHead.insertAdjacentElement("afterend", stateRow);
        }
        if (!resultPanel.querySelector(".peac-lesson-result-empty")) {
          var empty = el("div", "peac-lesson-result-empty", "生成后这里会出现下载入口。现在只需要填写左侧课时信息并点击“生成备课内容”。");
          stateRow.appendChild(empty);
        }
        if (statusPill && statusPill.parentElement !== stateRow) {
          statusPill.classList.add("peac-result-status-pill");
          stateRow.appendChild(statusPill);
        }
        var progressTitle = Array.from(resultPanel.querySelectorAll("div")).find(function (node) {
          return textOf(node).trim() === "当前进度";
        });
        var originalProgressCard = progressTitle ? progressTitle.parentElement : null;
        if (originalProgressCard) originalProgressCard.classList.add("peac-hidden-source");
        var progressCard = resultPanel.querySelector("[data-peac-stable-progress]");
        if (!progressCard) {
          progressCard = el("div", "peac-lesson-progress-card");
          progressCard.setAttribute("data-peac-stable-progress", "true");
          progressCard.innerHTML = [
            '<div class="peac-progress-title">当前进度</div>',
            '<div class="peac-progress-track"><span data-peac-progress-bar></span></div>',
            '<p data-peac-progress-phase>等待开始</p>',
            '<div class="peac-progress-compact" data-peac-progress-compact="true">',
            '<div><span>本次已用时</span><strong data-peac-elapsed>0:00</strong></div>',
            '<div><span>上次更新</span><strong data-peac-updated>0:00</strong></div>',
            '</div>'
          ].join("");
        }
        if (progressCard) {
          progressCard.classList.add("peac-lesson-progress-card");
          if (stateRow) stateRow.insertAdjacentElement("afterend", progressCard);
          updateStableLessonProgress(progressCard, section);
          if (!progressCard.querySelector("[data-peac-abort-lesson]")) {
            var abortButton = el("button", "peac-lesson-abort-button", "中断备课");
            abortButton.type = "button";
            abortButton.setAttribute("data-peac-abort-lesson", "true");
            abortButton.addEventListener("click", function () {
              abortLessonGeneration();
              var phase = progressCard.querySelector("[data-peac-progress-phase]");
              if (phase) phase.textContent = "已请求中断，正在停止当前备课任务。";
            });
            progressCard.appendChild(abortButton);
          }
        }
        var buttons = Array.from(resultPanel.querySelectorAll("button")).filter(function (button) {
          return !button.hasAttribute("data-peac-abort-lesson");
        });
        if (buttons.length && !resultPanel.querySelector(".peac-lesson-download-groups")) {
          var oldButtonGrid = buttons[0].parentElement;
          if (oldButtonGrid) oldButtonGrid.classList.add("peac-lesson-old-download-grid");
          var groups = el("div", "peac-lesson-download-groups");
          var primaryGroup = el("div", "peac-lesson-download-group");
          var singleGroup = el("div", "peac-lesson-download-group");
          var nextGroup = el("div", "peac-lesson-download-group peac-lesson-next-group");
          primaryGroup.innerHTML = '<p>主要结果</p>';
          singleGroup.innerHTML = '<p>单独下载</p>';
          nextGroup.innerHTML = '<p>下一步</p>';
          buttons.forEach(function (button) {
            var label = textOf(button);
            button.classList.add("peac-result-button");
            if (label.indexOf("一键下载") !== -1) {
              button.classList.add("peac-result-primary");
              primaryGroup.appendChild(button);
            } else {
              singleGroup.appendChild(button);
            }
          });
          var imageButton = el("button", "peac-result-button peac-result-next", "用 PPT 脚本生成课件图片");
          imageButton.type = "button";
          imageButton.addEventListener("click", function () {
            setActiveTab("images");
          });
          nextGroup.appendChild(imageButton);
          groups.appendChild(primaryGroup);
          groups.appendChild(singleGroup);
          groups.appendChild(nextGroup);
          resultPanel.appendChild(groups);
          syncLessonResultAvailability(resultPanel);
          if (resultPanel.dataset.peacDownloadObserver !== "true") {
            resultPanel.dataset.peacDownloadObserver = "true";
            new MutationObserver(function () {
              syncLessonResultAvailability(resultPanel);
            }).observe(resultPanel, { attributes: true, attributeFilter: ["disabled"], childList: true, subtree: true });
          }
        }
        syncLessonResultAvailability(resultPanel);
      }
    }
  }

  function enhanceImages(section) {
    if (!section) return;
    section.classList.add("peac-native-card", "peac-images-section");
    if (!section.querySelector(".peac-image-guide")) {
      var guide = el("div", "peac-image-guide");
      guide.innerHTML = [
        '<div><p class="peac-kicker">课件图</p><h2>放入脚本，解析页面，再生成课件图。</h2>',
        '<p>默认只按三步走。模型、清晰度、代理和对比功能都放在高级设置里。</p></div>',
        '<div class="peac-guide-side"><div class="peac-step-row"><span>1 放入脚本</span><span>2 解析</span><span>3 生成课件图</span></div><p>先试跑不消耗 API；真实生成时再关闭演示并填写密钥。</p></div>'
      ].join("");
      var first = section.firstElementChild;
      section.insertBefore(guide, first);
    }
    var shortcut = section.querySelector(".peac-image-compare-shortcut");
    if (!shortcut) {
      shortcut = el("button", "peac-image-compare-shortcut", "高级：先对比一页模型效果");
      shortcut.type = "button";
      shortcut.addEventListener("click", function () {
        setActiveTab("compare");
      });
    }
    if (!section.querySelector(".peac-image-advanced")) {
      var labels = Array.from(section.querySelectorAll("label"));
      var providerLabel = labels.find(function (label) { return textOf(label).indexOf("图片服务商") !== -1; });
      var modelLabel = labels.find(function (label) { return textOf(label).indexOf("模型") !== -1; });
      var apiKeyLabel = labels.find(function (label) { return textOf(label).indexOf("API Key") !== -1 || textOf(label).indexOf("Google API Key") !== -1; });
      var proxyLabel = labels.find(function (label) { return textOf(label).indexOf("代理网关") !== -1; });
      var baseLabel = labels.find(function (label) { return textOf(label).indexOf("API Base") !== -1; });
      var styleLabel = labels.find(function (label) { return textOf(label).indexOf("整体图片风格") !== -1; });
      var ratioLabel = labels.find(function (label) { return textOf(label).indexOf("比例") !== -1; });
      var optionGrid = ratioLabel ? ratioLabel.closest("div") : null;
      if (providerLabel || modelLabel || apiKeyLabel || baseLabel || styleLabel || proxyLabel || optionGrid) {
        var details = el("details", "peac-image-advanced");
        details.innerHTML = '<summary>图片生成设置（通常不用改）</summary><div class="peac-image-advanced-grid"></div>';
        var grid = details.querySelector(".peac-image-advanced-grid");
        var anchor = providerLabel || modelLabel || apiKeyLabel || baseLabel || styleLabel || optionGrid || proxyLabel;
        var anchorGroup = anchor.parentNode;
        var insertParent = anchorGroup && anchorGroup.parentNode ? anchorGroup.parentNode : anchor.parentNode;
        insertParent.insertBefore(details, anchorGroup || anchor);
        if (styleLabel) styleLabel.classList.add("peac-image-style-field");
        [providerLabel, modelLabel, apiKeyLabel, proxyLabel, baseLabel, styleLabel, optionGrid].forEach(function (node) {
          if (node && node.parentNode && node !== details) grid.appendChild(node);
        });
      }
    }
    var textarea = imageTextarea();
    var actionButtons = Array.from(section.querySelectorAll("button")).filter(function (button) {
      var label = textOf(button);
      return label === "解析脚本" || label === "一键生成图片" || label === "重试失败" || label === "下载图片包" || label.indexOf("下载成品") !== -1;
    });
    if (textarea && actionButtons.length && !section.querySelector(".peac-image-action-row")) {
      var actionRow = el("div", "peac-image-action-row");
      var oldActionParent = actionButtons[0].parentElement;
      if (oldActionParent) oldActionParent.classList.add("peac-image-old-action-grid");
      actionButtons.forEach(function (button) {
        button.classList.add("peac-image-flow-button");
        if (textOf(button) === "解析脚本") button.classList.add("peac-image-parse-button");
        if (textOf(button) === "一键生成图片") button.classList.add("peac-image-generate-button");
        if (textOf(button) === "重试失败") button.classList.add("peac-image-retry-button");
        if (textOf(button).indexOf("下载") !== -1) button.classList.add("peac-image-download-button");
        actionRow.appendChild(button);
      });
      var anchorLabel = textarea.closest("label") || textarea;
      anchorLabel.insertAdjacentElement("afterend", actionRow);
    }
    var advanced = section.querySelector(".peac-image-advanced");
    if (advanced && textarea) {
      if (shortcut && shortcut.parentElement !== advanced) {
        advanced.appendChild(shortcut);
      }
      Array.from(advanced.querySelectorAll("label")).forEach(function (label) {
        if (label.querySelector("textarea")) label.classList.add("peac-image-style-field");
        if (label.querySelector('input[type="checkbox"]') && textOf(label).indexOf("演示") !== -1) {
          label.classList.add("peac-image-demo-toggle");
          if (!label.querySelector(".peac-image-demo-copy")) {
            label.appendChild(el("span", "peac-image-demo-copy", "先试跑，不消耗 API"));
          }
        }
      });
      var textareaLabel = textarea.closest("label") || textarea;
      var leftColumn = textareaLabel.parentElement;
      var actionRow = section.querySelector(".peac-image-action-row");
      if (leftColumn && advanced.parentElement !== leftColumn) {
        if (actionRow && actionRow.parentElement === leftColumn) {
          actionRow.insertAdjacentElement("afterend", advanced);
        } else {
          textareaLabel.insertAdjacentElement("afterend", advanced);
        }
      }
    }
    var taskTitle = Array.from(section.querySelectorAll("div")).find(function (node) {
      return textOf(node).trim() === "图片任务";
    });
    var taskPanel = taskTitle ? taskTitle.closest("div[class]") : null;
    if (taskPanel) taskPanel.classList.add("peac-image-task-panel");
    var taskTitleGroup = taskTitle ? taskTitle.parentElement : null;
    var taskHead = taskTitleGroup ? taskTitleGroup.parentElement : null;
    var taskCard = taskHead ? taskHead.parentElement : null;
    if (taskTitle && taskTitleGroup && taskHead && taskCard) {
      taskCard.classList.add("peac-image-task-card");
      taskHead.classList.add("peac-image-task-head");
      taskTitle.classList.add("peac-image-task-title");
      var taskStatus = Array.from(taskTitleGroup.children).find(function (node) {
        return node !== taskTitle && textOf(node);
      });
      if (taskStatus) taskStatus.classList.add("peac-image-task-status");
      var progressTrack = Array.from(taskHead.children).find(function (node) {
        return node !== taskTitleGroup && node.querySelector("div");
      });
      if (progressTrack) progressTrack.classList.add("peac-image-task-progress");
      var taskBody = Array.from(taskCard.children).find(function (node) {
        return node !== taskHead && !node.classList.contains("peac-image-task-steps");
      });
      if (taskBody) {
        taskBody.classList.add("peac-image-task-body");
        var emptyText = textOf(taskBody);
        var isEmpty = emptyText.indexOf("请先带入") !== -1 || emptyText.indexOf("请先") !== -1 && emptyText.indexOf("解析脚本") !== -1;
        taskBody.classList.toggle("is-empty", isEmpty);
        if (isEmpty && taskBody.children.length === 1) {
          taskBody.children[0].classList.add("peac-image-task-empty");
          taskBody.children[0].textContent = "先在左侧放入或粘贴 PPT 脚本，再点击“解析脚本”。解析后这里会显示每页图片任务。";
        }
      }
      var steps = taskCard.querySelector(".peac-image-task-steps");
      if (!steps) {
        steps = el("div", "peac-image-task-steps");
        steps.innerHTML = "<span>1 解析脚本</span><span>2 生成图片</span><span>3 下载导出</span>";
        taskHead.insertAdjacentElement("afterend", steps);
      }
      var statusText = textOf(taskStatus) + " " + (taskBody ? textOf(taskBody) : "");
      var activeIndex = 0;
      if (statusText.indexOf("生成") !== -1 || statusText.indexOf("图片") !== -1 && statusText.indexOf("等待解析") === -1) activeIndex = 1;
      if (statusText.indexOf("完成") !== -1 || statusText.indexOf("下载") !== -1 || statusText.indexOf("导出") !== -1) activeIndex = 2;
      Array.from(steps.children).forEach(function (step, index) {
        step.classList.toggle("is-active", index === activeIndex);
        step.classList.toggle("is-done", index < activeIndex);
      });
    }
  }

  function moveResourceCards(resource) {
    var children = resource ? Array.from(resource.children) : [];
    var libraryCard = children.find(function (node) { return textOf(node).indexOf("校本资料库") !== -1; }) || findResourceCardByTitle("校本资料库", "后台设置与进度");
    var settingsCard = children.find(function (node) { return textOf(node).indexOf("后台设置与进度") !== -1; }) || findResourceCardByTitle("后台设置与进度", "校本资料库");
    if (libraryCard && !libraryCard.classList.contains("peac-native-card")) {
      panel("library").innerHTML = "";
      libraryCard.classList.add("peac-native-card");
      panel("library").appendChild(libraryCard);
    }
    if (settingsCard && !settingsCard.classList.contains("peac-native-card")) {
      panel("settings").innerHTML = "";
      settingsCard.classList.add("peac-native-card");
      panel("settings").appendChild(settingsCard);
    }
    if (resource) resource.classList.add("peac-hidden-source");
  }

  function enhanceLibrary(section) {
    if (!section) return;
    section.classList.add("peac-native-card", "peac-library-section");
    if (!section.querySelector(".peac-library-simple-note")) {
      var simpleNote = el("div", "peac-library-simple-note", '<strong>本次生成要参考哪些资料？</strong><span>可以不上传，直接备课；上传后勾选参与本次生成即可。</span>');
      section.insertBefore(simpleNote, section.firstElementChild);
    }
    var title = Array.from(section.querySelectorAll("h2, h3, div")).find(function (node) {
      return textOf(node).trim() === "校本资料库";
    });
    if (title) title.textContent = "资料";
    if (title) {
      title.classList.add("peac-library-title");
      var head = title.closest("div");
      if (head) {
        var node = head;
        for (var i = 0; node && i < 4; i += 1) {
          if (textOf(node).indexOf("上传") !== -1 || textOf(node).indexOf("按小学英语资料类型") !== -1) {
            head = node;
          }
          node = node.parentElement;
        }
        head.classList.add("peac-library-head");
      }
    }
    Array.from(section.querySelectorAll("button")).forEach(function (button) {
      var label = textOf(button);
      if (label === "上传") button.classList.add("peac-library-upload");
      if (label.indexOf("查看全部资料") !== -1) button.classList.add("peac-library-view-all");
      if (label === "删除") button.classList.add("peac-library-delete");
    });
    var typeNames = ["教材课标", "词句语篇", "错题检测", "班情反馈", "学校模板"];
    var typeCards = [];
    typeNames.forEach(function (name) {
      var item = Array.from(section.querySelectorAll("button, div, article")).find(function (node) {
        var text = textOf(node);
        return text.indexOf(name) !== -1 && text.length < 80;
      });
      if (item) {
        item.classList.add("peac-library-type-card");
        typeCards.push(item);
      }
    });
    if (typeCards.length) {
      var typeGrid = typeCards[0].parentElement;
      if (typeGrid) typeGrid.classList.add("peac-library-type-grid");
    }
    Array.from(section.querySelectorAll("input[type='text'], input[type='search'], select")).forEach(function (control) {
      var parent = control.parentElement;
      if (parent && !control.closest(".peac-library-item")) parent.classList.add("peac-library-filter-field");
    });
    Array.from(section.querySelectorAll("input[type='checkbox']")).forEach(function (checkbox) {
      var row = checkbox.parentElement;
      for (var depth = 0; row && depth < 7; depth += 1) {
        var rowText = textOf(row);
        if ((rowText.indexOf(".pdf") !== -1 || rowText.indexOf(".doc") !== -1 || rowText.indexOf("个片段") !== -1) && rowText.indexOf("删除") !== -1) {
          break;
        }
        row = row.parentElement;
      }
      if (!row || row === section) return;
      row.classList.add("peac-library-item");
      checkbox.classList.add("peac-library-check");
      var titleNode = Array.from(row.querySelectorAll("strong, h3, h4, div, span")).find(function (node) {
        var text = textOf(node);
        return text.indexOf(".pdf") !== -1 || text.indexOf(".doc") !== -1;
      });
      if (titleNode) titleNode.classList.add("peac-library-item-title");
      Array.from(row.querySelectorAll("select")).forEach(function (select) {
        select.classList.add("peac-library-item-type");
      });
      var metadataInputs = Array.from(row.querySelectorAll("input[type='text']"));
      if (metadataInputs.length) {
        var metadataGrid = metadataInputs[0].parentElement;
        if (metadataGrid && !metadataGrid.closest(".peac-library-item-meta-details")) {
          metadataGrid.classList.add("peac-library-item-meta-grid");
          var metaDetails = el("details", "peac-library-item-meta-details", "<summary>编辑年级 / 单元 / 标签</summary>");
          metadataGrid.parentNode.insertBefore(metaDetails, metadataGrid);
          metaDetails.appendChild(metadataGrid);
        }
      }
    });
  }

  function enhanceSettings(section) {
    if (!section || section.dataset.peacSettingsEnhanced === "true") return;
    section.dataset.peacSettingsEnhanced = "true";
    section.classList.add("peac-settings-section");
    var title = Array.from(section.querySelectorAll("h2, h3, div")).find(function (node) {
      return textOf(node).trim() === "后台设置与进度";
    });
    if (title) title.textContent = "设置";
    if (!section.querySelector(".peac-settings-simple-note")) {
      var note = el("div", "peac-settings-simple-note", '<strong>模型与密钥、网络与代理、高级 Prompt / 调试都在这里。</strong><span>日常备课不用先打开；只有缺密钥、换模型或排查网络时再看。</span>');
      section.insertBefore(note, section.firstElementChild);
    }
  }

  function imageTextarea() {
    var images = panel("images");
    if (!images) return null;
    return Array.from(images.querySelectorAll("textarea")).find(function (node) {
      return (node.placeholder || "").indexOf("PPT 脚本") !== -1 || textOf(node.parentNode).indexOf("PPT 脚本") !== -1;
    });
  }

  function parseSlides(script) {
    var text = String(script || "").replace(/\r\n/g, "\n").trim();
    if (!text) return [];
    var matches = Array.from(text.matchAll(/^(?:#{1,3}\s*)?(?:Slide|第)\s*(\d+)\s*(?:页)?[：:\-\s]*(.*)$/gim));
    if (!matches.length) return [{ slideNumber: 1, title: "当前脚本", body: text }];
    return matches.map(function (match, index) {
      var start = match.index + match[0].length;
      var end = index + 1 < matches.length ? matches[index + 1].index : text.length;
      return {
        slideNumber: Number(match[1]) || index + 1,
        title: (match[2] || "").trim() || "第 " + (index + 1) + " 页",
        body: text.slice(start, end).trim()
      };
    });
  }

  function ensureCompare() {
    var compare = panel("compare");
    if (!compare || compare.dataset.ready === "true") return;
    compare.dataset.ready = "true";
    compare.innerHTML = [
      '<section class="peac-compare-panel">',
      '<div class="peac-compare-intro"><div><p class="peac-kicker">可选高级步骤</p>',
      '<h2>公开课或高质量课件，再用同一页脚本比较模型效果。</h2>',
      '<p>日常备课可以跳过这一步。只有想先比较文字准确率、版式和投屏清晰度时，再回来选择一页生成候选图。</p></div>',
      '<button type="button" data-compare-goto-images>去放入 PPT 脚本</button></div>',
      '<div class="peac-compare-setup">',
      '<div class="peac-compare-toolbar">',
      '<label>对比页<select data-compare-slide></select></label>',
      '<label>统一风格<input data-compare-style type="text" value="温暖明亮的儿童绘本插画风，适合小学英语课堂，主体清晰，投屏可读。"></label>',
      '</div>',
      '<div class="peac-compare-actions"><button type="button" data-compare-add>添加更多模型</button><button type="button" data-compare-run>开始对比生成</button></div>',
      '</div>',
      '<div class="peac-compare-stage">',
      '<div class="peac-compare-stage-head"><div><strong>选择参与对比的模型</strong><p>默认只放两个候选模型，密钥和接口地址仍放在“接口设置”里。</p></div></div>',
      '<div data-compare-targets class="peac-compare-targets"></div>',
      '</div>',
      '<div class="peac-compare-result-stage">',
      '<div class="peac-compare-stage-head"><div><strong>对比结果</strong><p data-compare-status class="peac-compare-status">先放入 PPT 脚本并选择模型 API Key。</p></div></div>',
      '<div data-compare-results class="peac-compare-results"><div class="peac-compare-empty">点击“开始对比生成”后，这里会按模型展示候选图。生成完成后，可以把满意的模型设为整套课件图片通道。</div></div>',
      '</div>',
      '</section>'
    ].join("");
    compare.addEventListener("click", function (event) {
      if (event.target.closest("[data-compare-goto-images]")) setActiveTab("images");
      if (event.target.closest("[data-compare-add]")) addCompareTarget();
      if (event.target.closest("[data-compare-run]")) runCompare();
    });
    addCompareTarget("google");
    addCompareTarget("zhipu");
    refreshCompareSlides();
  }

  function addCompareTarget(provider) {
    var list = document.querySelector("[data-compare-targets]");
    if (!list) return;
    var providerKey = provider || "zhipu";
    var preset = comparePresets[providerKey] || comparePresets.zhipu;
    var row = el("div", "peac-compare-target");
    row.innerHTML = [
      '<div class="peac-compare-target-main">',
      '<label class="peac-check"><input type="checkbox" data-field="enabled" checked>参与对比</label>',
      '<label>名称<input type="text" data-field="name" value="' + preset.label + '"></label>',
      '<label>服务商<select data-field="provider"></select></label>',
      '<label>模型<select data-field="model"></select></label>',
      '</div>',
      '<details class="peac-compare-api"><summary>接口设置</summary><div>',
      '<label>API Key<input type="password" data-field="apiKey" placeholder="仅用于本次浏览器会话"></label>',
      '<label>API Base<input type="url" data-field="apiBaseUrl" value="' + preset.defaultBase + '"></label>',
      '<label>代理<input type="url" data-field="proxyUrl" placeholder="可选"></label>',
      '</div></details>'
    ].join("");
    var providerSelect = row.querySelector('[data-field="provider"]');
    Object.keys(comparePresets).forEach(function (key) {
      var option = new Option(comparePresets[key].label, key);
      providerSelect.appendChild(option);
    });
    providerSelect.value = providerKey;
    fillCompareModels(row, preset.defaultModel);
    providerSelect.addEventListener("change", function () {
      var next = comparePresets[providerSelect.value];
      row.querySelector('[data-field="name"]').value = next.label;
      row.querySelector('[data-field="apiBaseUrl"]').value = next.defaultBase;
      fillCompareModels(row, next.defaultModel);
    });
    list.appendChild(row);
  }

  function fillCompareModels(row, value) {
    var provider = row.querySelector('[data-field="provider"]').value;
    var preset = comparePresets[provider] || comparePresets.google;
    var select = row.querySelector('[data-field="model"]');
    select.innerHTML = "";
    preset.models.forEach(function (item) {
      select.appendChild(new Option(item[1], item[0]));
    });
    select.value = value || preset.defaultModel;
  }

  function refreshCompareSlides() {
    var select = document.querySelector("[data-compare-slide]");
    if (!select) return;
    var textarea = imageTextarea();
    var slides = parseSlides(textarea ? textarea.value : "");
    var current = select.value;
    var signature = slides.length ? slides.map(function (slide) {
      return slide.slideNumber + ":" + slide.title;
    }).join("|") : "empty";
    if (select.dataset.peacSlidesSignature === signature) return;
    select.dataset.peacSlidesSignature = signature;
    select.innerHTML = "";
    if (!slides.length) {
      select.appendChild(new Option("请先在课件图片页放入脚本", ""));
      return;
    }
    slides.forEach(function (slide) {
      select.appendChild(new Option("Slide " + String(slide.slideNumber).padStart(2, "0") + " " + slide.title, String(slide.slideNumber)));
    });
    if (current && Array.from(select.options).some(function (option) { return option.value === current; })) select.value = current;
  }

  function compareConfigFromRow(row) {
    var provider = row.querySelector('[data-field="provider"]').value;
    var model = row.querySelector('[data-field="model"]').value;
    return {
      provider: provider,
      providerLabel: comparePresets[provider] ? comparePresets[provider].label : provider,
      model: model,
      name: row.querySelector('[data-field="name"]').value || model,
      apiKey: row.querySelector('[data-field="apiKey"]').value,
      apiBaseUrl: row.querySelector('[data-field="apiBaseUrl"]').value,
      proxyUrl: row.querySelector('[data-field="proxyUrl"]').value
    };
  }

  function comparePayload(config, prompt) {
    return {
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      apiBaseUrl: config.apiBaseUrl,
      proxyUrl: config.proxyUrl,
      prompt: prompt,
      aspectRatio: "16:9",
      resolution: "2K"
    };
  }

  function setNativeValue(node, value) {
    if (!node) return false;
    var previousValue = node.value;
    var prototype = Object.getPrototypeOf(node);
    var descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "value") : null;
    if (descriptor && descriptor.set) descriptor.set.call(node, value || "");
    else node.value = value || "";
    var tracker = node._valueTracker;
    if (tracker && previousValue !== node.value) {
      try {
        tracker.setValue(previousValue);
      } catch {}
    }
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function findLabeledControl(root, text, selector) {
    if (!root) return null;
    var label = Array.from(root.querySelectorAll("label")).find(function (node) {
      return textOf(node).indexOf(text) !== -1;
    });
    return label ? label.querySelector(selector || "input, select, textarea") : null;
  }

  function imageConfigControls() {
    var images = panel("images");
    return {
      provider: findLabeledControl(images, "图片服务商", "select"),
      model: findLabeledControl(images, "模型", "select"),
      apiKey: findLabeledControl(images, "API Key", 'input[type="password"], input'),
      apiBaseUrl: findLabeledControl(images, "API Base", "input"),
      proxyUrl: findLabeledControl(images, "代理网关", "input")
    };
  }

  function setSelectValue(select, value) {
    if (!select) return false;
    var exists = Array.from(select.options).some(function (option) {
      return option.value === value;
    });
    return exists ? setNativeValue(select, value) : false;
  }

  function showImageConfigNotice(message) {
    var guideBody = panel("images") && panel("images").querySelector(".peac-image-guide > div");
    if (!guideBody) return;
    var notice = guideBody.querySelector("[data-image-config-notice]");
    if (!notice) {
      notice = el("p", "peac-image-config-notice");
      notice.setAttribute("data-image-config-notice", "");
      guideBody.appendChild(notice);
    }
    notice.textContent = message;
  }

  function applyCompareConfigToImages(config) {
    setActiveTab("images");
    var controls = imageConfigControls();
    var status = document.querySelector("[data-compare-status]");
    if (!controls.provider || !controls.model) {
      if (status) status.textContent = "未找到课件图片页的模型配置控件，请刷新页面后重试。";
      return;
    }
    var appliedProvider = setSelectValue(controls.provider, config.provider);
    var details = panel("images") && panel("images").querySelector(".peac-image-advanced");
    if (details) details.open = true;
    function applySecondaryFields() {
      var current = imageConfigControls();
      setNativeValue(current.apiKey, config.apiKey);
      setNativeValue(current.apiBaseUrl, config.apiBaseUrl);
      setNativeValue(current.proxyUrl, config.proxyUrl);
      setSelectValue(current.model, config.model);
      refreshStatusPanel();
    }
    applySecondaryFields();
    window.setTimeout(applySecondaryFields, 80);
    window.setTimeout(applySecondaryFields, 240);
    var message = appliedProvider
      ? "已设为整套生成通道：" + config.providerLabel + " / " + config.model
      : "课件图片页暂未找到该服务商，请确认 BUG-001 修复是否已生效。";
    showImageConfigNotice(message);
    if (status) status.textContent = message;
  }

  function buildPrompt(slide, style) {
    return [
      "请根据以下小学英语 PPT 页面脚本生成一张 16:9 课件图片。",
      "要求：画面清晰、适合投屏、儿童友好；若包含中英文文字，必须拼写准确、排版端正。",
      style ? "统一风格：" + style : "",
      "页面标题：" + slide.title,
      "页面内容：",
      slide.body
    ].filter(Boolean).join("\n");
  }

  async function runCompare() {
    refreshCompareSlides();
    var status = document.querySelector("[data-compare-status]");
    var results = document.querySelector("[data-compare-results]");
    var textarea = imageTextarea();
    var slides = parseSlides(textarea ? textarea.value : "");
    var slideNo = Number((document.querySelector("[data-compare-slide]") || {}).value || 0);
    var slide = slides.find(function (item) { return item.slideNumber === slideNo; }) || slides[0];
    var rows = Array.from(document.querySelectorAll(".peac-compare-target")).filter(function (row) {
      return row.querySelector('[data-field="enabled"]').checked;
    });
    if (!slide) {
      if (status) status.textContent = "请先到“课件图片”页放入或带入 PPT 脚本。";
      return;
    }
    rows = rows.filter(function (row) { return row.querySelector('[data-field="apiKey"]').value.trim(); });
    if (!rows.length) {
      if (status) status.textContent = "请至少启用一个模型并填写 API Key。";
      return;
    }
    var style = (document.querySelector("[data-compare-style]") || {}).value || "";
    var prompt = buildPrompt(slide, style);
    if (results) results.innerHTML = "";
    if (status) status.textContent = "正在生成 Slide " + slide.slideNumber + " 的对比图...";
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var config = compareConfigFromRow(row);
      var card = el("article", "peac-compare-result", '<div class="peac-compare-preview">生成中...</div><strong></strong><span></span>');
      card.querySelector("strong").textContent = config.name;
      card.querySelector("span").textContent = config.provider + " / " + config.model;
      if (results) results.appendChild(card);
      try {
        var started = Date.now();
        var response = await fetch("/api/images/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(comparePayload(config, prompt))
        });
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(data.error || "生成失败");
        card.querySelector(".peac-compare-preview").innerHTML = '<img alt="' + config.name.replace(/"/g, "") + '">';
        card.querySelector("img").src = "data:" + (data.mimeType || "image/png") + ";base64," + data.imageBase64;
        card.querySelector("span").textContent += " / " + Math.round((Date.now() - started) / 1000) + " 秒";
        var useButton = el("button", "peac-compare-use", "设为整套生成通道");
        useButton.type = "button";
        (function (selectedConfig) {
          useButton.addEventListener("click", function () {
            applyCompareConfigToImages(selectedConfig);
          });
        })(config);
        card.appendChild(useButton);
      } catch (error) {
        card.classList.add("is-failed");
        card.querySelector(".peac-compare-preview").textContent = "生成失败";
        card.querySelector("span").textContent = error && error.message ? error.message : "生成失败";
      }
    }
    if (status) status.textContent = "对比完成。Google、豆包、智谱和通义模型均可回到“课件图片”页作为整套生成通道使用。";
  }

  function restructure() {
    var main = document.querySelector("main");
    if (!main || !main.querySelector("header")) return;
    document.body.classList.add("peac-workbench-ready");
    enhanceHeader();
    ensureShell(main);
    ensureStatusPanel(main);
    ensureHome();
    ensureEmptyPanels();
    ensureCompare();

    var lesson = findLessonSection(main);
    var images = findImagesSection(main);
    var resource = findResourceSection(main);
    if (lesson) markNativePanel(lesson, "lesson");
    if (images) markNativePanel(images, "images");
    var signature = [!!lesson, !!images, !!resource].join("|");
    if (signature !== lastSignature) {
      lastSignature = signature;
      moveResourceCards(resource);
    }
    enhanceLesson(panelContent("lesson"));
    enhanceImages(panelContent("images"));
    enhanceLibrary(panelContent("library"));
    enhanceSettings(panelContent("settings"));
    ensureDmxapiConfig();
    applyDmxTextToLessonControls();
    applyDmxImageToImageControls();
    refreshCompareSlides();
    applyActiveTab();
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function () {
      scheduled = false;
      restructure();
    });
  }

  function afterHydration(callback) {
    var run = function () {
      window.setTimeout(function () {
        window.requestAnimationFrame(callback);
      }, 180);
    };
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
  }

  patchDmxapiFetch();
  patchLessonAbortFetch();
  installDmxImageGenerateGuard();

  afterHydration(function () {
    schedule();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  });
  window.addEventListener("hashchange", function () {
    var next = tabFromHash();
    if (next) {
      activeTab = next;
      window.localStorage.setItem("peac-active-tab-v2", activeTab);
      applyActiveTab();
      if (next === "library" || next === "settings") revealResourcePanels(next);
      if (next === "compare") refreshCompareSlides();
    }
  });
})();
