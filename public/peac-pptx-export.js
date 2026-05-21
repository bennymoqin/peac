(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var SLIDE_W = 12192000;
  var SLIDE_H = 6858000;
  var PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

  function utf8(value) {
    return new TextEncoder().encode(value);
  }

  var crcTable = null;
  function getCrcTable() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (var i = 0; i < 256; i += 1) {
      var c = i;
      for (var k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
    return crcTable;
  }

  function crc32(bytes) {
    var table = getCrcTable();
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i += 1) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function write16(out, value) {
    out.push(value & 0xff, (value >>> 8) & 0xff);
  }

  function write32(out, value) {
    out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }

  function dosDateTime(date) {
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function zipStore(entries) {
    var fileParts = [];
    var central = [];
    var offset = 0;
    var now = dosDateTime(new Date());

    entries.forEach(function (entry) {
      var name = utf8(entry.name);
      var data = entry.data instanceof Uint8Array ? entry.data : utf8(entry.data);
      var crc = crc32(data);
      var local = [];

      write32(local, 0x04034b50);
      write16(local, 20);
      write16(local, 0x0800);
      write16(local, 0);
      write16(local, now.time);
      write16(local, now.date);
      write32(local, crc);
      write32(local, data.length);
      write32(local, data.length);
      write16(local, name.length);
      write16(local, 0);
      local.push.apply(local, Array.from(name));
      fileParts.push(new Uint8Array(local), data);

      var cent = [];
      write32(cent, 0x02014b50);
      write16(cent, 20);
      write16(cent, 20);
      write16(cent, 0x0800);
      write16(cent, 0);
      write16(cent, now.time);
      write16(cent, now.date);
      write32(cent, crc);
      write32(cent, data.length);
      write32(cent, data.length);
      write16(cent, name.length);
      write16(cent, 0);
      write16(cent, 0);
      write16(cent, 0);
      write16(cent, 0);
      write32(cent, 0);
      write32(cent, offset);
      cent.push.apply(cent, Array.from(name));
      central.push(new Uint8Array(cent));

      offset += local.length + data.length;
    });

    var centralSize = central.reduce(function (sum, part) { return sum + part.length; }, 0);
    var end = [];
    write32(end, 0x06054b50);
    write16(end, 0);
    write16(end, 0);
    write16(end, entries.length);
    write16(end, entries.length);
    write32(end, centralSize);
    write32(end, offset);
    write16(end, 0);

    return new Blob(fileParts.concat(central, [new Uint8Array(end)]), { type: PPTX_MIME });
  }

  function escapeXml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function contentTypes(slides) {
    var imageDefaults = Array.from(new Set(slides.map(function (slide) { return slide.ext; }))).map(function (ext) {
      var type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
      return '<Default Extension="' + ext + '" ContentType="' + type + '"/>';
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      imageDefaults +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      slides.map(function (_, index) {
        return '<Override PartName="/ppt/slides/slide' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
          '<Override PartName="/ppt/notesSlides/notesSlide' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>';
      }).join("") +
      '</Types>';
  }

  function presentationXml(slides) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' +
      slides.map(function (_, index) { return '<p:sldId id="' + (256 + index) + '" r:id="rId' + (index + 2) + '"/>'; }).join("") +
      '</p:sldIdLst><p:sldSz cx="' + SLIDE_W + '" cy="' + SLIDE_H + '" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';
  }

  function presentationRels(slides) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
      slides.map(function (_, index) {
        return '<Relationship Id="rId' + (index + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + (index + 1) + '.xml"/>';
      }).join("") +
      '</Relationships>';
  }

  function staticParts(slides) {
    return [
      { name: "[Content_Types].xml", data: contentTypes(slides) },
      { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' },
      { name: "ppt/presentation.xml", data: presentationXml(slides) },
      { name: "ppt/_rels/presentation.xml.rels", data: presentationRels(slides) },
      { name: "ppt/slideMasters/slideMaster1.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + SLIDE_W + '" cy="' + SLIDE_H + '"/><a:chOff x="0" y="0"/><a:chExt cx="' + SLIDE_W + '" cy="' + SLIDE_H + '"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>' },
      { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>' },
      { name: "ppt/slideLayouts/slideLayout1.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + SLIDE_W + '" cy="' + SLIDE_H + '"/><a:chOff x="0" y="0"/><a:chExt cx="' + SLIDE_W + '" cy="' + SLIDE_H + '"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>' },
      { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>' },
      { name: "ppt/theme/theme1.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="PEAC"><a:themeElements><a:clrScheme name="PEAC"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F9FAFB"/></a:lt2><a:accent1><a:srgbClr val="2453FF"/></a:accent1><a:accent2><a:srgbClr val="1F7A5C"/></a:accent2><a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="EF4444"/></a:accent4><a:accent5><a:srgbClr val="8B5CF6"/></a:accent5><a:accent6><a:srgbClr val="06B6D4"/></a:accent6><a:hlink><a:srgbClr val="2453FF"/></a:hlink><a:folHlink><a:srgbClr val="6D28D9"/></a:folHlink></a:clrScheme><a:fontScheme name="PEAC"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="Microsoft YaHei"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme><a:fmtScheme name="PEAC"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>' },
      { name: "docProps/core.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>PEAC 成品课件</dc:title><dc:creator>PEAC</dc:creator><cp:lastModifiedBy>PEAC</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString() + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + new Date().toISOString() + '</dcterms:modified></cp:coreProperties>' },
      { name: "docProps/app.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>PEAC</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>' + slides.length + '</Slides></Properties>' }
    ];
  }

  function slideXml(slide) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + SLIDE_W + '" cy="' + SLIDE_H + '"/><a:chOff x="0" y="0"/><a:chExt cx="' + SLIDE_W + '" cy="' + SLIDE_H + '"/></a:xfrm></p:grpSpPr>' +
      '<p:pic><p:nvPicPr><p:cNvPr id="2" name="' + escapeXml(slide.title || "Slide") + '"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + SLIDE_W + '" cy="' + SLIDE_H + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }

  function slideRels(slide, index) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image' + (index + 1) + "." + slide.ext + '"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide' + (index + 1) + '.xml"/>' +
      '</Relationships>';
  }

  function notesXml(slide, index) {
    var body = [slide.title, slide.text, slide.suggestion].filter(Boolean).join("\n\n");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6858000" cy="9144000"/><a:chOff x="0" y="0"/><a:chExt cx="6858000" cy="9144000"/></a:xfrm></p:grpSpPr>' +
      '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1200"/><a:t>' + escapeXml(body || ("Slide " + (index + 1))) + '</a:t></a:r></a:p></p:txBody></p:sp>' +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
  }

  function notesRels(index) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide' + (index + 1) + '.xml"/>' +
      '</Relationships>';
  }

  function createPptx(slides) {
    var entries = staticParts(slides);
    slides.forEach(function (slide, index) {
      entries.push({ name: "ppt/slides/slide" + (index + 1) + ".xml", data: slideXml(slide) });
      entries.push({ name: "ppt/slides/_rels/slide" + (index + 1) + ".xml.rels", data: slideRels(slide, index) });
      entries.push({ name: "ppt/notesSlides/notesSlide" + (index + 1) + ".xml", data: notesXml(slide, index) });
      entries.push({ name: "ppt/notesSlides/_rels/notesSlide" + (index + 1) + ".xml.rels", data: notesRels(index) });
      entries.push({ name: "ppt/media/image" + (index + 1) + "." + slide.ext, data: slide.bytes });
    });
    return zipStore(entries);
  }

  function textOf(node) {
    return (node && (node.innerText || node.textContent) || "").replace(/\s+/g, " ").trim();
  }

  function findImageSection() {
    return Array.from(document.querySelectorAll("section")).find(function (section) {
      var text = textOf(section);
      return text.indexOf("课件图片") !== -1 && text.indexOf("图片任务") !== -1 && text.indexOf("下载图片包") !== -1;
    });
  }

  function getDoneCards(section) {
    return Array.from(section.querySelectorAll("article")).filter(function (article) {
      return textOf(article).indexOf("已完成") !== -1 && article.querySelector("img[src]");
    });
  }

  function textAfter(card, label) {
    var lines = (card.innerText || card.textContent || "").split(/\n+/).map(function (line) { return line.trim(); });
    var found = lines.find(function (line) { return line.indexOf(label) === 0; });
    return found ? found.slice(label.length).trim() : "";
  }

  function extensionFromBlob(blob) {
    if (blob.type.indexOf("jpeg") !== -1 || blob.type.indexOf("jpg") !== -1) return "jpg";
    if (blob.type.indexOf("webp") !== -1) return "webp";
    return "png";
  }

  async function collectSlides(section) {
    var cards = getDoneCards(section);
    var slides = [];
    for (var i = 0; i < cards.length; i += 1) {
      var card = cards[i];
      var image = card.querySelector("img[src]");
      if (!image) continue;
      var response = await fetch(image.src);
      var blob = await response.blob();
      var titleNode = card.querySelector("h3");
      var title = titleNode ? titleNode.textContent.replace(/^Slide\s+\d+\s*/i, "").trim() : "Slide " + (i + 1);
      slides.push({
        title: title || "Slide " + (i + 1),
        text: textAfter(card, "页面文字："),
        suggestion: textAfter(card, "图片建议："),
        ext: extensionFromBlob(blob),
        bytes: new Uint8Array(await blob.arrayBuffer())
      });
    }
    return slides;
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function refreshButton(section, button) {
    var doneCount = getDoneCards(section).length;
    var busy = textOf(section).indexOf("生成中") !== -1;
    button.disabled = doneCount === 0 || busy;
    button.title = busy ? "图片生成完成后可导出 PPTX" : doneCount ? "把已完成图片按每页一张导出为 PPTX" : "请先生成至少一张图片";
  }

  async function handleExport(section, button) {
    if (button.disabled) return;
    var original = button.textContent;
    button.disabled = true;
    button.textContent = "正在制作 PPTX";
    try {
      var slides = await collectSlides(section);
      if (!slides.length) {
        window.alert("请先生成至少一张图片。");
        return;
      }
      download(createPptx(slides), "peac-成品课件.pptx");
    } catch (error) {
      console.error(error);
      window.alert("PPTX 导出失败，请确认图片已经生成完成后再试。");
    } finally {
      button.textContent = original;
      refreshButton(section, button);
    }
  }

  function ensureButton() {
    var section = findImageSection();
    if (!section) return;
    var imagePackButton = Array.from(section.querySelectorAll("button")).find(function (button) {
      return textOf(button) === "下载图片包";
    });
    if (!imagePackButton) return;
    var button = section.querySelector("[data-peac-pptx-export]");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.peacPptxExport = "true";
      button.className = imagePackButton.className || "h-11 rounded-xl bg-[#1f7a5c] text-sm font-semibold text-white disabled:bg-zinc-300 disabled:text-zinc-500";
      button.textContent = "下载成品 PPTX";
      button.addEventListener("click", function () { handleExport(section, button); });
      imagePackButton.insertAdjacentElement("afterend", button);
    }
    refreshButton(section, button);
  }

  function appendOnce(selector, createNode) {
    if (document.querySelector(selector)) return;
    document.head.appendChild(createNode());
  }

  appendOnce('link[href="/peac-ui-workbench.css"]', function () {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/peac-ui-workbench.css";
    return link;
  });

  if (document.documentElement.dataset.peacDmxImageGuard !== "true") {
    appendOnce('script[data-peac-ui-workbench-version="dmxfix4"]', function () {
      var script = document.createElement("script");
      script.defer = true;
      script.dataset.peacUiWorkbenchVersion = "dmxfix4";
      script.src = "/peac-ui-workbench.js?v=dmxfix4";
      return script;
    });
  }

  var raf = 0;
  function scheduleEnsure() {
    if (raf) return;
    raf = window.requestAnimationFrame(function () {
      raf = 0;
      ensureButton();
    });
  }

  function afterHydration(callback) {
    var run = function () {
      window.setTimeout(function () {
        window.requestAnimationFrame(callback);
      }, 1500);
    };
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
  }

  afterHydration(function () {
    scheduleEnsure();
    new MutationObserver(scheduleEnsure).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  });
})();
