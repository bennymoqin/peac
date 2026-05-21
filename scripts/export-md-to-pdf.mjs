import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

function splitToCodepoints(text) {
  const items = [];
  for (const ch of text) items.push(ch);
  return items;
}

function wrapLine(line, maxWidth) {
  const cps = splitToCodepoints(line);
  if (cps.length <= maxWidth) return [line];
  const parts = [];
  for (let i = 0; i < cps.length; i += maxWidth) {
    parts.push(cps.slice(i, i + maxWidth).join(""));
  }
  return parts;
}

function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function readUInt16(buf, offset) {
  return buf.readUInt16BE(offset);
}

function readInt16(buf, offset) {
  return buf.readInt16BE(offset);
}

function readUInt32(buf, offset) {
  return buf.readUInt32BE(offset);
}

function readTag(buf, offset) {
  return buf.toString("ascii", offset, offset + 4);
}

function parseTtfTables(buffer) {
  const numTables = readUInt16(buffer, 4);
  const tables = new Map();
  let recordOffset = 12;
  for (let i = 0; i < numTables; i += 1) {
    const tag = readTag(buffer, recordOffset);
    const offset = readUInt32(buffer, recordOffset + 8);
    const length = readUInt32(buffer, recordOffset + 12);
    tables.set(tag, { offset, length });
    recordOffset += 16;
  }
  return tables;
}

function parseUnitsPerEm(ttf, tables) {
  const head = tables.get("head");
  if (!head) throw new Error("字体缺少 head 表");
  return readUInt16(ttf, head.offset + 18);
}

function parseHhea(ttf, tables) {
  const hhea = tables.get("hhea");
  if (!hhea) throw new Error("字体缺少 hhea 表");
  const ascent = readInt16(ttf, hhea.offset + 4);
  const descent = readInt16(ttf, hhea.offset + 6);
  const numberOfHMetrics = readUInt16(ttf, hhea.offset + 34);
  return { ascent, descent, numberOfHMetrics };
}

function parseMaxp(ttf, tables) {
  const maxp = tables.get("maxp");
  if (!maxp) throw new Error("字体缺少 maxp 表");
  const numGlyphs = readUInt16(ttf, maxp.offset + 4);
  return { numGlyphs };
}

function parseHmtx(ttf, tables, numGlyphs, numberOfHMetrics) {
  const hmtx = tables.get("hmtx");
  if (!hmtx) throw new Error("字体缺少 hmtx 表");
  const widths = new Array(numGlyphs).fill(0);
  let p = hmtx.offset;
  let lastAdvance = 0;
  for (let i = 0; i < numGlyphs; i += 1) {
    if (i < numberOfHMetrics) {
      const advance = readUInt16(ttf, p);
      lastAdvance = advance;
      widths[i] = advance;
      p += 4;
    } else {
      widths[i] = lastAdvance;
      p += 2;
    }
  }
  return widths;
}

function parseCmapSubtable(ttf, offset) {
  const format = readUInt16(ttf, offset);
  if (format === 4) {
    const segCount = readUInt16(ttf, offset + 6) / 2;
    const endCodeOffset = offset + 14;
    const startCodeOffset = endCodeOffset + segCount * 2 + 2;
    const idDeltaOffset = startCodeOffset + segCount * 2;
    const idRangeOffsetOffset = idDeltaOffset + segCount * 2;

    const endCode = new Array(segCount);
    const startCode = new Array(segCount);
    const idDelta = new Array(segCount);
    const idRangeOffset = new Array(segCount);
    for (let i = 0; i < segCount; i += 1) {
      endCode[i] = readUInt16(ttf, endCodeOffset + i * 2);
      startCode[i] = readUInt16(ttf, startCodeOffset + i * 2);
      idDelta[i] = readInt16(ttf, idDeltaOffset + i * 2);
      idRangeOffset[i] = readUInt16(ttf, idRangeOffsetOffset + i * 2);
    }

    return {
      format,
      idRangeOffsetOffset,
      segCount,
      endCode,
      startCode,
      idDelta,
      idRangeOffset,
      getGlyphId(codepoint) {
        if (codepoint > 0xffff) return 0;
        for (let i = 0; i < segCount; i += 1) {
          if (codepoint < startCode[i] || codepoint > endCode[i]) continue;
          const ro = idRangeOffset[i];
          if (ro === 0) {
            return (codepoint + idDelta[i]) & 0xffff;
          }
          const glyphIndexAddress =
            idRangeOffsetOffset + i * 2 + ro + (codepoint - startCode[i]) * 2;
          const glyphId = readUInt16(ttf, glyphIndexAddress);
          if (glyphId === 0) return 0;
          return (glyphId + idDelta[i]) & 0xffff;
        }
        return 0;
      },
    };
  }

  if (format === 12) {
    const nGroups = readUInt32(ttf, offset + 12);
    const groupsOffset = offset + 16;
    const groups = [];
    for (let i = 0; i < nGroups; i += 1) {
      const p = groupsOffset + i * 12;
      groups.push({
        startCharCode: readUInt32(ttf, p),
        endCharCode: readUInt32(ttf, p + 4),
        startGlyphId: readUInt32(ttf, p + 8),
      });
    }
    return {
      format,
      groups,
      getGlyphId(codepoint) {
        for (const g of groups) {
          if (codepoint < g.startCharCode || codepoint > g.endCharCode) continue;
          return g.startGlyphId + (codepoint - g.startCharCode);
        }
        return 0;
      },
    };
  }

  return { format, getGlyphId() { return 0; } };
}

function selectCmap(ttf, tables) {
  const cmap = tables.get("cmap");
  if (!cmap) throw new Error("字体缺少 cmap 表");
  const cmapOffset = cmap.offset;
  const numTables = readUInt16(ttf, cmapOffset + 2);
  const records = [];
  for (let i = 0; i < numTables; i += 1) {
    const p = cmapOffset + 4 + i * 8;
    const platformID = readUInt16(ttf, p);
    const encodingID = readUInt16(ttf, p + 2);
    const subOffset = readUInt32(ttf, p + 4);
    records.push({ platformID, encodingID, subOffset });
  }

  const preferred =
    records.find((r) => r.platformID === 3 && r.encodingID === 10) ||
    records.find((r) => r.platformID === 3 && r.encodingID === 1) ||
    records.find((r) => r.platformID === 0) ||
    records[0];

  if (!preferred) throw new Error("字体 cmap 表为空");
  return parseCmapSubtable(ttf, cmapOffset + preferred.subOffset);
}

function findUnicodeFontPath() {
  const candidates = [
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "";
}

function unicodeToUtf16beHex(codepoint) {
  if (codepoint <= 0xffff) {
    return codepoint.toString(16).padStart(4, "0").toUpperCase();
  }
  const cp = codepoint - 0x10000;
  const high = 0xd800 + ((cp >> 10) & 0x3ff);
  const low = 0xdc00 + (cp & 0x3ff);
  return (
    high.toString(16).padStart(4, "0") +
    low.toString(16).padStart(4, "0")
  ).toUpperCase();
}

function encodeLineToCidHex(line, cidByCodepoint) {
  let hex = "";
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    const cid = cidByCodepoint.get(cp) || 0;
    hex += cid.toString(16).padStart(4, "0").toUpperCase();
  }
  return hex;
}

function buildToUnicodeCMap(sortedCodepoints, cidByCodepoint) {
  const header = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
  ];

  const body = [];
  const pairs = sortedCodepoints.map((cp) => {
    const cid = cidByCodepoint.get(cp);
    const cidHex = cid.toString(16).padStart(4, "0").toUpperCase();
    const uniHex = unicodeToUtf16beHex(cp);
    return [`<${cidHex}>`, `<${uniHex}>`];
  });

  const chunkSize = 100;
  for (let i = 0; i < pairs.length; i += chunkSize) {
    const chunk = pairs.slice(i, i + chunkSize);
    body.push(`${chunk.length} beginbfchar`);
    for (const [a, b] of chunk) {
      body.push(`${a} ${b}`);
    }
    body.push("endbfchar");
  }

  const footer = [
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ];

  return Buffer.from([...header, ...body, ...footer].join("\n") + "\n", "utf8");
}

function buildCidToGidMap(maxCid, gidByCid) {
  const buf = Buffer.alloc((maxCid + 1) * 2);
  buf.writeUInt16BE(0, 0);
  for (let cid = 1; cid <= maxCid; cid += 1) {
    const gid = gidByCid[cid] || 0;
    buf.writeUInt16BE(gid & 0xffff, cid * 2);
  }
  return buf;
}

function buildPages(allLines) {
  const maxLinesPerPage = 64;
  const pages = [];
  let current = [];

  for (const line of allLines) {
    current.push(line);
    if (current.length >= maxLinesPerPage) {
      pages.push(current);
      current = [];
    }
  }

  if (current.length) pages.push(current);
  return pages;
}

function buildPdf(pagesTextLines) {
  const fontPath = findUnicodeFontPath();
  if (!fontPath) {
    throw new Error("未找到可用的中文字体文件（Arial Unicode.ttf）。");
  }

  const fontRaw = fs.readFileSync(fontPath);
  const fontCompressed = zlib.deflateSync(fontRaw);

  const tables = parseTtfTables(fontRaw);
  const unitsPerEm = parseUnitsPerEm(fontRaw, tables);
  const { ascent, descent, numberOfHMetrics } = parseHhea(fontRaw, tables);
  const { numGlyphs } = parseMaxp(fontRaw, tables);
  const advanceWidths = parseHmtx(fontRaw, tables, numGlyphs, numberOfHMetrics);
  const cmap = selectCmap(fontRaw, tables);

  const codepoints = new Set();
  for (const page of pagesTextLines) {
    for (const line of page) {
      for (const ch of line) {
        codepoints.add(ch.codePointAt(0));
      }
    }
  }

  const sortedCodepoints = Array.from(codepoints).filter((v) => typeof v === "number").sort((a, b) => a - b);
  const cidByCodepoint = new Map();
  const gidByCid = [0];
  const widthByCid = [0];

  let cid = 1;
  for (const cp of sortedCodepoints) {
    cidByCodepoint.set(cp, cid);
    const gid = cmap.getGlyphId(cp) || 0;
    gidByCid[cid] = gid;
    const aw = advanceWidths[gid] || advanceWidths[0] || Math.floor(unitsPerEm / 2);
    widthByCid[cid] = Math.max(1, Math.round((aw * 1000) / unitsPerEm));
    cid += 1;
  }
  const maxCid = cid - 1;

  const toUnicode = buildToUnicodeCMap(sortedCodepoints, cidByCodepoint);
  const toUnicodeCompressed = zlib.deflateSync(toUnicode);

  const cidToGid = buildCidToGidMap(maxCid, gidByCid);
  const cidToGidCompressed = zlib.deflateSync(cidToGid);

  const wArray = widthByCid.slice(1).map((w) => String(w)).join(" ");
  const fontWidths = `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ArialUnicodeMS /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 0 0 R /CIDToGIDMap 0 0 R /DW 500 /W [1 [${wArray}]] >>`;

  const objects = [];
  const offsets = [];

  function addObject(content) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    objects.push(buf);
    return objects.length;
  }

  const fontFileId = addObject(
    Buffer.from(
      `<< /Length ${fontCompressed.length} /Filter /FlateDecode /Length1 ${fontRaw.length} >>\nstream\n`,
      "utf8",
    ),
  );
  objects[fontFileId - 1] = Buffer.concat([objects[fontFileId - 1], fontCompressed, Buffer.from("\nendstream", "utf8")]);

  const toUnicodeId = addObject(
    Buffer.from(
      `<< /Length ${toUnicodeCompressed.length} /Filter /FlateDecode >>\nstream\n`,
      "utf8",
    ),
  );
  objects[toUnicodeId - 1] = Buffer.concat([objects[toUnicodeId - 1], toUnicodeCompressed, Buffer.from("\nendstream", "utf8")]);

  const cidToGidId = addObject(
    Buffer.from(
      `<< /Length ${cidToGidCompressed.length} /Filter /FlateDecode >>\nstream\n`,
      "utf8",
    ),
  );
  objects[cidToGidId - 1] = Buffer.concat([objects[cidToGidId - 1], cidToGidCompressed, Buffer.from("\nendstream", "utf8")]);

  const fontDescriptorId = addObject(
    `<< /Type /FontDescriptor /FontName /ArialUnicodeMS /Flags 32 /FontBBox [-200 ${descent} 1200 ${ascent}] /ItalicAngle 0 /Ascent ${ascent} /Descent ${descent} /CapHeight ${ascent} /StemV 80 /FontFile2 ${fontFileId} 0 R >>`,
  );

  const cidFontObj = fontWidths
    .replace("/FontDescriptor 0 0 R", `/FontDescriptor ${fontDescriptorId} 0 R`)
    .replace("/CIDToGIDMap 0 0 R", `/CIDToGIDMap ${cidToGidId} 0 R`);
  const cidFontId = addObject(cidFontObj);

  const type0FontId = addObject(
    `<< /Type /Font /Subtype /Type0 /BaseFont /ArialUnicodeMS /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`,
  );

  const pageIds = [];

  for (const lines of pagesTextLines) {
    const fontSize = 10;
    const lineHeight = 12;
    const marginLeft = 40;
    const marginTop = 48;
    const pageWidth = 595;
    const pageHeight = 842;
    const startX = marginLeft;
    const startY = pageHeight - marginTop;

    const commands = [];
    commands.push("BT");
    commands.push(`/F1 ${fontSize} Tf`);
    commands.push(`1 0 0 1 ${startX} ${startY} Tm`);

    let firstLine = true;
    for (const line of lines) {
      if (!firstLine) commands.push(`0 -${lineHeight} Td`);
      firstLine = false;
      const hex = encodeLineToCidHex(line, cidByCodepoint);
      commands.push(`<${hex}> Tj`);
    }
    commands.push("ET");

    const streamBody = Buffer.from(commands.join("\n") + "\n", "utf8");
    const streamCompressed = zlib.deflateSync(streamBody);
    const contentId = addObject(
      Buffer.from(
        `<< /Length ${streamCompressed.length} /Filter /FlateDecode >>\nstream\n`,
        "utf8",
      ),
    );
    objects[contentId - 1] = Buffer.concat([objects[contentId - 1], streamCompressed, Buffer.from("\nendstream", "utf8")]);

    const pageId = addObject(
      `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${type0FontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  const pagesId = addObject(`<< /Type /Pages /Count ${pageIds.length} /Kids [ ${kids} ] >>`);

  for (const pageId of pageIds) {
    const idx = pageId - 1;
    const str = objects[idx].toString("utf8");
    objects[idx] = Buffer.from(str.replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`), "utf8");
  }

  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const header = Buffer.from("%PDF-1.7\n%\xFF\xFF\xFF\xFF\n", "binary");
  let pdf = Buffer.from(header);
  offsets.push(0);

  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    const objHeader = Buffer.from(`${i + 1} 0 obj\n`, "utf8");
    const objFooter = Buffer.from("\nendobj\n", "utf8");
    pdf = Buffer.concat([pdf, objHeader, objects[i], objFooter]);
  }

  const xrefStart = pdf.length;
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  pdf = Buffer.concat([pdf, Buffer.from(xref, "utf8"), Buffer.from(trailer, "utf8")]);
  return pdf;
}

function main() {
  const args = process.argv.slice(2);
  const inputArg = args[0] || "";
  const outputArg = args[1] || "";

  if (!inputArg || !outputArg) {
    process.stderr.write("Usage: node scripts/export-md-to-pdf.mjs <input.md> <output.pdf>\n");
    process.exit(1);
  }

  const repoRoot = path.resolve(process.cwd());
  const inputPath = path.resolve(repoRoot, inputArg);
  const outputPath = path.resolve(repoRoot, outputArg);
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  const raw = fs.readFileSync(inputPath, "utf8");
  const text = normalizeLineEndings(raw);
  const lines = [];

  lines.push(path.basename(inputPath));
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN")}`);
  lines.push("");

  const wrapWidth = 96;
  for (const line of text.split("\n")) {
    for (const part of wrapLine(line, wrapWidth)) {
      lines.push(part);
    }
  }

  const pages = buildPages(lines);
  const pdf = buildPdf(pages);
  fs.writeFileSync(outputPath, pdf);
  process.stdout.write(`OK\n${outputPath}\n`);
}

main();


