/**
 * Markdown parser utilities.
 * Parses raw markdown text and identifies syntax regions for decoration.
 *
 * Each region has: { type, from, to, contentFrom, contentTo, meta }
 * - from/to: full range including syntax markers
 * - contentFrom/contentTo: range of the actual content (excluding markers)
 * - meta: additional info (heading level, language, url, etc.)
 */

/**
 * @typedef {Object} MarkdownRegion
 * @property {string} type
 * @property {number} from
 * @property {number} to
 * @property {number} contentFrom
 * @property {number} contentTo
 * @property {Object} [meta]
 */

/**
 * Parse a document string and return all markdown regions.
 * @param {string} doc - The full document text
 * @returns {MarkdownRegion[]}
 */
export function parseMarkdownRegions(doc) {
  const regions = []
  const lines = doc.split('\n')
  let pos = 0
  let inCodeBlock = false
  let codeBlockStart = -1
  let codeBlockLang = ''
  let codeBlockMarkerLen = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineStart = pos
    const lineEnd = pos + line.length

    // Code block fences
    const fenceMatch = line.match(/^(`{3,}|~{3,})(.*)$/)
    if (fenceMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeBlockStart = lineStart
        codeBlockLang = fenceMatch[2].trim()
        codeBlockMarkerLen = fenceMatch[1].length
        pos = lineEnd + 1
        continue
      } else if (fenceMatch[1].length >= codeBlockMarkerLen && fenceMatch[1][0] === (lines[findCodeBlockStartLine(lines, codeBlockStart, pos)]?.match(/^(`{3,}|~{3,})/)?.[1]?.[0] || '`')) {
        regions.push({
          type: 'code-block',
          from: codeBlockStart,
          to: lineEnd,
          contentFrom: codeBlockStart,
          contentTo: lineEnd,
          meta: { language: codeBlockLang }
        })
        inCodeBlock = false
        codeBlockStart = -1
        codeBlockLang = ''
        pos = lineEnd + 1
        continue
      }
    }

    if (inCodeBlock) {
      pos = lineEnd + 1
      continue
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const markEnd = lineStart + level
      regions.push({
        type: 'heading',
        from: lineStart,
        to: lineEnd,
        contentFrom: markEnd + 1,
        contentTo: lineEnd,
        meta: { level, markFrom: lineStart, markTo: markEnd + 1 }
      })
      pos = lineEnd + 1
      continue
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      regions.push({
        type: 'hr',
        from: lineStart,
        to: lineEnd,
        contentFrom: lineStart,
        contentTo: lineEnd,
        meta: {}
      })
      pos = lineEnd + 1
      continue
    }

    // Blockquote
    const bqMatch = line.match(/^(>\s?)(.*)$/)
    if (bqMatch) {
      regions.push({
        type: 'blockquote',
        from: lineStart,
        to: lineEnd,
        contentFrom: lineStart + bqMatch[1].length,
        contentTo: lineEnd,
        meta: { markFrom: lineStart, markTo: lineStart + bqMatch[1].length }
      })
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)([-*+])\s(.+)$/)
    if (ulMatch) {
      const indent = ulMatch[1].length
      const markerStart = lineStart + indent
      regions.push({
        type: 'list-bullet',
        from: lineStart,
        to: lineEnd,
        contentFrom: markerStart + 2,
        contentTo: lineEnd,
        meta: { marker: ulMatch[2], markerFrom: markerStart, markerTo: markerStart + 1, indent }
      })
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+)\.\s(.+)$/)
    if (olMatch) {
      const indent = olMatch[1].length
      const markerStart = lineStart + indent
      const markerEnd = markerStart + olMatch[2].length + 1
      regions.push({
        type: 'list-ordered',
        from: lineStart,
        to: lineEnd,
        contentFrom: markerEnd + 1,
        contentTo: lineEnd,
        meta: { number: olMatch[2], markerFrom: markerStart, markerTo: markerEnd, indent }
      })
    }

    // Task list
    const taskMatch = line.match(/^(\s*[-*+]\s)\[([xX ])\]\s(.+)$/)
    if (taskMatch) {
      const checkStart = lineStart + taskMatch[1].length
      regions.push({
        type: 'task-list',
        from: lineStart,
        to: lineEnd,
        contentFrom: checkStart + 4,
        contentTo: lineEnd,
        meta: {
          checked: taskMatch[2].toLowerCase() === 'x',
          checkFrom: checkStart,
          checkTo: checkStart + 3
        }
      })
    }

    // Inline patterns on this line
    parseInlineRegions(line, lineStart, regions)

    pos = lineEnd + 1
  }

  return regions
}

function findCodeBlockStartLine(lines, codeBlockStart, currentPos) {
  let p = 0
  for (let i = 0; i < lines.length; i++) {
    if (p === codeBlockStart) return i
    p += lines[i].length + 1
  }
  return 0
}

/**
 * 反转义 Markdown 文本中的反斜杠转义。
 */
function unescapeMd(text) {
  return text.replace(/\\([\\`*_{}\[\]()#+\-.!<>~| ])/g, '$1')
}

/**
 * 扫描一行中的所有图片语法，推入 regions 并返回每个图片的文档区间。
 * 支持：
 *   ![alt](url)            ![alt](<url with spaces>)
 *   ![alt](url "title")    ![alt]()  （空地址也能识别，渲染为空态）
 *   嵌套括号、方括号 / 括号的反斜杠转义
 */
function parseInlineImages(line, lineStart, regions) {
  const ranges = []
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] !== '!' || line[i + 1] !== '[') continue

    // 读取 alt：遇到未转义的 ] 结束
    let p = i + 2
    let alt = ''
    let altClosed = -1
    while (p < line.length) {
      const ch = line[p]
      if (ch === '\\' && p + 1 < line.length) {
        alt += ch + line[p + 1]
        p += 2
        continue
      }
      if (ch === ']') { altClosed = p; break }
      alt += ch
      p++
    }
    if (altClosed === -1 || line[altClosed + 1] !== '(') continue

    let q = altClosed + 2
    let dest = ''
    let destClosed = -1

    if (line[q] === '<') {
      // 尖括号目标：遇到未转义的 > 结束
      q++
      while (q < line.length) {
        const ch = line[q]
        if (ch === '\\' && q + 1 < line.length) {
          dest += ch + line[q + 1]
          q += 2
          continue
        }
        if (ch === '>') break
        dest += ch
        q++
      }
      if (line[q] !== '>') continue
      q++
      // 允许可选的 title
      while (q < line.length && /\s/.test(line[q])) q++
      if (line[q] === '"' || line[q] === "'") {
        const quote = line[q]
        q++
        while (q < line.length && line[q] !== quote) q++
        if (line[q] !== quote) continue
        q++
      }
      while (q < line.length && /\s/.test(line[q])) q++
      if (line[q] !== ')') continue
      destClosed = q
    } else {
      // 普通目标：允许嵌套平衡的圆括号
      let depth = 1
      outer:
      while (q < line.length) {
        const ch = line[q]
        if (ch === '\\' && q + 1 < line.length) {
          dest += ch + line[q + 1]
          q += 2
          continue
        }
        switch (ch) {
          case '(': depth++; dest += ch; q++; break
          case ')':
            depth--
            if (depth === 0) { destClosed = q; break outer }
            dest += ch; q++; break
          default: dest += ch; q++
        }
      }
      if (destClosed === -1) continue

      // 剥离可选 title： /path "title" 或 /path 'title'
      const titleMatch = dest.match(/^([\s\S]*?)\s+["'][^"']*["']\s*$/)
      if (titleMatch) dest = titleMatch[1]
      dest = dest.trimEnd()
    }

    const from = lineStart + i
    const to = lineStart + destClosed + 1
    const altFrom = lineStart + i + 2
    const altTo = lineStart + altClosed
    regions.push({
      type: 'image',
      from,
      to,
      contentFrom: altFrom,
      contentTo: altTo,
      meta: { alt: unescapeMd(alt), url: unescapeMd(dest.trim()) }
    })
    ranges.push({ from, to })
    i = destClosed
  }
  return ranges
}

/**
 * 解析行内 Markdown 语法。
 */
function parseInlineRegions(line, lineStart, regions) {
  // Image: ![alt](dest) / ![alt](<dest>) / ![alt](dest "title") / ![alt]()
  // 使用扫描器而非单条正则，以支持空地址、尖括号地址、转义字符与嵌套括号。
  const imageRanges = parseInlineImages(line, lineStart, regions)

  // Link: [text](url) — but not images and not ranges already covered by an image
  const linkRe = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g
  let m
  while ((m = linkRe.exec(line)) !== null) {
    const from = lineStart + m.index
    const to = from + m[0].length
    const insideImage = imageRanges.some(r => r.from <= from && to <= r.to)
    if (insideImage) continue
    regions.push({
      type: 'link',
      from,
      to,
      contentFrom: from + 1,
      contentTo: from + 1 + m[1].length,
      meta: { text: m[1], url: m[2] }
    })
  }

  // Bold: **text** or __text__
  const boldRe = /(\*\*|__)(?!\s)(.+?)(?<!\s)\1/g
  while ((m = boldRe.exec(line)) !== null) {
    regions.push({
      type: 'bold',
      from: lineStart + m.index,
      to: lineStart + m.index + m[0].length,
      contentFrom: lineStart + m.index + 2,
      contentTo: lineStart + m.index + 2 + m[2].length,
      meta: { marker: m[1] }
    })
  }

  // Italic: *text* or _text_ (not bold)
  const italicRe = /(?<!\*|\w)(\*|_)(?!\s|\1)(.+?)(?<!\s)\1(?!\*|\w)/g
  while ((m = italicRe.exec(line)) !== null) {
    // Skip if this is part of a bold marker
    const fullFrom = lineStart + m.index
    const isBold = regions.some(r => r.type === 'bold' && r.from <= fullFrom && r.to >= fullFrom + m[0].length)
    if (isBold) continue
    regions.push({
      type: 'italic',
      from: fullFrom,
      to: fullFrom + m[0].length,
      contentFrom: fullFrom + 1,
      contentTo: fullFrom + 1 + m[2].length,
      meta: { marker: m[1] }
    })
  }

  // Strikethrough: ~~text~~
  const strikeRe = /~~(?!\s)(.+?)(?<!\s)~~/g
  while ((m = strikeRe.exec(line)) !== null) {
    regions.push({
      type: 'strikethrough',
      from: lineStart + m.index,
      to: lineStart + m.index + m[0].length,
      contentFrom: lineStart + m.index + 2,
      contentTo: lineStart + m.index + 2 + m[1].length,
      meta: {}
    })
  }

  // Inline code: `code`
  const codeRe = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g
  while ((m = codeRe.exec(line)) !== null) {
    const markerLen = m[1].length
    regions.push({
      type: 'inline-code',
      from: lineStart + m.index,
      to: lineStart + m.index + m[0].length,
      contentFrom: lineStart + m.index + markerLen,
      contentTo: lineStart + m.index + markerLen + m[2].length,
      meta: { markerLen }
    })
  }
}

/**
 * Check if a position falls within any region.
 * @param {MarkdownRegion[]} regions
 * @param {number} pos
 * @returns {MarkdownRegion|null}
 */
export function regionAtPos(regions, pos) {
  return regions.find(r => pos >= r.from && pos <= r.to) || null
}

/**
 * Check if a cursor line overlaps with a region.
 * @param {MarkdownRegion} region
 * @param {number} lineFrom
 * @param {number} lineTo
 * @returns {boolean}
 */
export function cursorOnRegion(region, lineFrom, lineTo) {
  return region.from <= lineTo && region.to >= lineFrom
}
