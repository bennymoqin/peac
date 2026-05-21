#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const encoder = new TextEncoder();
const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const EMU = 914400;
const SLIDE_W = 13.333333;
const SLIDE_H = 7.5;
const SLIDE_CX = Math.round(SLIDE_W * EMU);
const SLIDE_CY = Math.round(SLIDE_H * EMU);

function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(parts) {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (0xffffffff ^ crc) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function zip(entries) {
  const files = [];
  const central = [];
  const { date, time } = dosDateTime();
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const content = typeof entry.content === "string" ? encoder.encode(entry.content) : entry.content;
    const crc = crc32(content);
    const localHeader = concat([
      u32(0x04034b50),
      u16(20),
      u16(2048),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      name,
    ]);

    files.push(localHeader, content);
    central.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(2048),
        u16(0),
        u16(time),
        u16(date),
        u32(crc),
        u32(content.length),
        u32(content.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ])
    );
    offset += localHeader.length + content.length;
  }

  const centralBytes = concat(central);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  ]);

  return concat([...files, centralBytes, end]);
}

function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .trim();
}

function imageInfo(filePath, explicitMime) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const mime =
    explicitMime ||
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
    }[ext] ||
    "image/png";
  const pptExt = mime.includes("jpeg") ? "jpg" : mime.split("/")[1] || ext || "png";
  return { mime, ext: pptExt === "jpeg" ? "jpg" : pptExt };
}

function parseSlideScript(markdown) {
  const text = String(markdown || "").replace(/\r\n/g, "\n");
  const matches = [...text.matchAll(/(?:^|\n)#{1,3}\s*(?:Slide\s*)?(\d+|第\s*\d+\s*页)[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s*(?:Slide\s*)?(?:\d+|第\s*\d+\s*页)|\s*$)/gi)];
  return matches.map((match, index) => {
    const block = cleanText(match[2] || "");
    const titleLine = block.split("\n").find(Boolean) || `Slide ${index + 1}`;
    return { slideNumber: index + 1, title: titleLine.slice(0, 80), notes: block };
  });
}

function discoverSlides(inputDir, scriptText) {
  const manifestNames = ["index.json", "manifest.json", "slides.json", "ppt-image-index.json"];
  let manifest = null;
  for (const name of manifestNames) {
    const file = path.join(inputDir, name);
    if (fs.existsSync(file)) {
      manifest = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      break;
    }
  }

  const scriptSlides = parseSlideScript(scriptText);
  const files = fs
    .readdirSync(inputDir)
    .filter((name) => /\.(png|jpe?g|gif|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));

  const rawSlides = Array.isArray(manifest)
    ? manifest
    : Array.isArray(manifest?.slides)
      ? manifest.slides
      : Array.isArray(manifest?.items)
        ? manifest.items
        : [];

  if (rawSlides.length) {
    return rawSlides
      .map((item, index) => {
        const imageName = item.imageFileName || item.fileName || item.image || item.path || files[index];
        if (!imageName) return null;
        return {
          slideNumber: Number(item.slideNumber || index + 1),
          title: item.title || scriptSlides[index]?.title || `Slide ${index + 1}`,
          notes: item.notes || item.visibleText || item.prompt || scriptSlides[index]?.notes || "",
          imagePath: path.resolve(inputDir, imageName),
          mimeType: item.mimeType,
        };
      })
      .filter(Boolean)
      .filter((item) => fs.existsSync(item.imagePath));
  }

  return files.map((fileName, index) => ({
    slideNumber: index + 1,
    title: scriptSlides[index]?.title || `Slide ${index + 1}`,
    notes: scriptSlides[index]?.notes || "",
    imagePath: path.join(inputDir, fileName),
  }));
}

function shapeText(id, name, x, y, cx, cy, size, text, options = {}) {
  const bold = options.bold ? ' b="1"' : "";
  const fill = options.fill ? `<a:solidFill><a:srgbClr val="${options.fill}"/></a:solidFill>` : "";
  return `
    <p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>${fill}</p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square" anchor="mid"/><a:lstStyle/>
        <a:p><a:r><a:rPr lang="zh-CN" sz="${size}"${bold}/><a:t>${xml(text)}</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>`;
}

function slideXml(slide, index, opts) {
  const title = slide.title || `Slide ${index + 1}`;
  const overlay = opts.showTitle
    ? shapeText(4, "Title Overlay", 457200, 342900, 8229600, 548640, 2200, title, {
        bold: true,
        fill: "FFFFFF",
      })
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
      <p:pic>
        <p:nvPicPr><p:cNvPr id="2" name="${xml(title)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_CX}" cy="${SLIDE_CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
      </p:pic>
      ${overlay}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function notesXml(slide, index) {
  const notes = cleanText(slide.notes || slide.prompt || "");
  const text = notes || `${slide.title || `Slide ${index + 1}`}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="685800" y="914400"/><a:ext cx="5486400" cy="6858000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1600"/><a:t>${xml(text)}</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:notes>`;
}

function createPptx(slides, options = {}) {
  if (!slides.length) throw new Error("没有找到可写入 PPTX 的图片。");

  const entries = [];
  const slideOverrides = [];
  const notesOverrides = [];
  const imageDefaults = new Set(["png"]);
  const slideIds = [];
  const presentationRels = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>',
  ];

  slides.forEach((slide, index) => {
    const slideNo = index + 1;
    const image = fs.readFileSync(slide.imagePath);
    const info = imageInfo(slide.imagePath, slide.mimeType);
    imageDefaults.add(info.ext);
    const imagePath = `ppt/media/image${slideNo}.${info.ext}`;

    slideIds.push(`<p:sldId id="${256 + index}" r:id="rId${slideNo + 1}"/>`);
    presentationRels.push(`<Relationship Id="rId${slideNo + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideNo}.xml"/>`);
    slideOverrides.push(`<Override PartName="/ppt/slides/slide${slideNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
    notesOverrides.push(`<Override PartName="/ppt/notesSlides/notesSlide${slideNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`);

    entries.push(
      { name: `ppt/slides/slide${slideNo}.xml`, content: slideXml(slide, index, options) },
      {
        name: `ppt/slides/_rels/slide${slideNo}.xml.rels`,
        content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${slideNo}.${info.ext}"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${slideNo}.xml"/>
</Relationships>`,
      },
      { name: `ppt/notesSlides/notesSlide${slideNo}.xml`, content: notesXml(slide, index) },
      {
        name: `ppt/notesSlides/_rels/notesSlide${slideNo}.xml.rels`,
        content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideNo}.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>
</Relationships>`,
      },
      { name: imagePath, content: image }
    );
  });

  const defaults = [...imageDefaults]
    .map((ext) => {
      const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
      return `<Default Extension="${xml(ext)}" ContentType="${contentType}"/>`;
    })
    .join("\n  ");

  const now = new Date().toISOString();
  return zip([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${defaults}
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slideOverrides.join("\n  ")}
  ${notesOverrides.join("\n  ")}
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    },
    {
      name: "docProps/app.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>PEAC</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slides.length}</Slides><Notes>${slides.length}</Notes>
</Properties>`,
    },
    {
      name: "docProps/core.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xml(options.title || "PEAC 授课课件")}</dc:title><dc:creator>PEAC</dc:creator><cp:lastModifiedBy>PEAC</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`,
    },
    {
      name: "ppt/presentation.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slideIds.join("")}</p:sldIdLst>
  <p:sldSz cx="${SLIDE_CX}" cy="${SLIDE_CY}" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`,
    },
    {
      name: "ppt/_rels/presentation.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${presentationRels.join("\n  ")}
</Relationships>`,
    },
    {
      name: "ppt/slideMasters/slideMaster1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`,
    },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
    },
    {
      name: "ppt/slideLayouts/slideLayout1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`,
    },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
    },
    {
      name: "ppt/notesMasters/notesMaster1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
</p:notesMaster>`,
    },
    {
      name: "ppt/notesMasters/_rels/notesMaster1.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
    },
    {
      name: "ppt/theme/theme1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="PEAC">
  <a:themeElements>
    <a:clrScheme name="PEAC"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="2453FF"/></a:accent1><a:accent2><a:srgbClr val="1F7A5C"/></a:accent2><a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="DC2626"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0EA5E9"/></a:accent6><a:hlink><a:srgbClr val="2453FF"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>
    <a:fontScheme name="PEAC"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="PEAC"><a:fillStyleLst><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/>
</a:theme>`,
    },
    ...entries,
  ]);
}

function parseArgs(argv) {
  const args = { showTitle: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" || arg === "-i") args.input = argv[++i];
    else if (arg === "--output" || arg === "-o") args.output = argv[++i];
    else if (arg === "--script" || arg === "-s") args.script = argv[++i];
    else if (arg === "--title") args.title = argv[++i];
    else if (arg === "--show-title") args.showTitle = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`PEAC PPTX image deck builder

Usage:
  node tools/pptx-from-images.js --input <image-pack-folder> --output <deck.pptx> [--script ppt.md] [--title "课题"]

The input folder can contain:
  - slide images named in order, such as slide-01.png, slide-02.png
  - optional index.json / manifest.json / slides.json with fields:
    slideNumber, title, notes, prompt, visibleText, imageFileName

Options:
  --show-title   add a small title overlay on each slide
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input || !args.output) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const inputDir = path.resolve(args.input);
  const outputFile = path.resolve(args.output);
  const scriptText = args.script ? fs.readFileSync(path.resolve(args.script), "utf8") : "";
  const slides = discoverSlides(inputDir, scriptText);
  const pptx = createPptx(slides, { title: args.title, showTitle: args.showTitle });

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, Buffer.from(pptx));
  console.log(`已生成 PPTX：${outputFile}`);
  console.log(`共写入 ${slides.length} 页。`);
}

if (require.main === module) {
  main();
}

module.exports = {
  createPptx,
  discoverSlides,
};
