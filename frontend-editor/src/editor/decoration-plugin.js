import {
  ViewPlugin,
  Decoration,
  WidgetType
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { parseMarkdownRegions } from './markdown-parser'
import { watchImage, retryImage } from './image-state'
import { classifyUrl } from './image-utils'

/** SVG 图标均为静态常量，不拼接用户数据 */
const ICON_IMAGE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
const ICON_WARNING = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
const ICON_BROKEN = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/><line x1="15" y1="3" x2="21" y2="9"/></svg>'
const ICON_RETRY = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'

/**
 * HR Widget — renders a horizontal rule
 */
class HrWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement('hr')
    hr.className = 'md-hr'
    return hr
  }
  ignoreEvent() { return false }
}

/**
 * 安全地把一段 HTML 图标放进容器，后续用户文本一律走 textContent。
 */
function setIcon(el, svg) {
  el.innerHTML = svg
  const svgEl = el.firstElementChild
  if (svgEl) svgEl.setAttribute('aria-hidden', 'true')
}

function truncate(text, max = 72) {
  const s = String(text || '')
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * Image Widget —— 状态驱动的图片预览。
 *
 * 状态来自 image-state 注册中心（按 URL 共享）：
 *   loading / loaded / error / timeout / empty / local / unsupported
 * 任何状态都只影响视觉层；底层 Markdown 原文始终保留，点击外部区域或把光标
 * 移入该行即可回到原文编辑，因此未知地址、未知协议、超时、重试都不会破坏正文。
 */
class ImageWidget extends WidgetType {
  constructor(alt, url) {
    super()
    this.alt = alt
    this.url = url
  }

  toDOM() {
    const wrapper = document.createElement('span')
    wrapper.className = 'md-image'
    wrapper.contentEditable = 'false'
    wrapper.setAttribute('data-image-url', this.url)

    let rendered = ''

    const render = (state) => {
      const sig = `${state.status}|${state.error || ''}`
      if (sig === rendered) return
      rendered = sig
      paint(wrapper, this.alt, this.url, state)
    }

    this._unwatch = watchImage(this.url, render)
    return wrapper
  }

  destroy(dom) {
    if (this._unwatch) this._unwatch()
    this._unwatch = null
    dom.textContent = ''
  }

  /** 让 CodeMirror 忽略 widget 内部的指针/键盘事件，避免点击重试时移动光标 */
  ignoreEvent(event) {
    if (event.type === 'mousedown' || event.type === 'click' ||
        event.type === 'dblclick' || event.type === 'keydown') {
      return true
    }
    return false
  }

  eq(other) { return other.url === this.url && other.alt === this.alt }

  updateDOM() { return true }
}

/**
 * 根据状态把卡片绘制进容器（重绘而非增量打补丁，状态切换简单且可恢复）。
 */
function paint(wrapper, alt, url, state) {
  wrapper.textContent = ''
  wrapper.classList.remove(
    'md-image--loading', 'md-image--loaded', 'md-image--error',
    'md-image--empty', 'md-image--local', 'md-image--unsupported'
  )

  if (state.status === 'loaded') {
    wrapper.classList.add('md-image--loaded')
    const img = document.createElement('img')
    img.className = 'md-image__img'
    img.src = url
    img.alt = alt || ''
    img.referrerPolicy = 'no-referrer'
    // 注册中心已知 loaded；若浏览器侧仍失败（如缓存失效），回落到错误卡片并可重试
    img.onerror = () => retryImage(url)
    wrapper.appendChild(img)
    if (alt) {
      const cap = document.createElement('span')
      cap.className = 'md-image__caption'
      cap.textContent = alt
      wrapper.appendChild(cap)
    }
    return
  }

  if (state.status === 'loading') {
    wrapper.classList.add('md-image--loading')
    const card = document.createElement('span')
    card.className = 'md-image-card md-image-card--loading'

    const spinner = document.createElement('span')
    spinner.className = 'md-image-spinner'
    card.appendChild(spinner)

    const title = document.createElement('span')
    title.className = 'md-image-card__title'
    title.textContent = '图片加载中…'
    card.appendChild(title)

    const detail = document.createElement('span')
    detail.className = 'md-image-card__detail'
    detail.textContent = truncate(url || alt || '')
    card.appendChild(detail)
    wrapper.appendChild(card)
    return
  }

  // --- 可恢复的空态 / 失败态 ---
  wrapper.classList.add(`md-image--${state.status}`)
  const card = document.createElement('span')
  card.className = 'md-image-card'

  const icon = document.createElement('span')
  icon.className = 'md-image-card__icon'
  const titleEl = document.createElement('span')
  titleEl.className = 'md-image-card__title'
  const detailEl = document.createElement('span')
  detailEl.className = 'md-image-card__detail'
  const hintEl = document.createElement('span')
  hintEl.className = 'md-image-card__hint'

  const showUrl = truncate(url, 80)

  switch (state.status) {
    case 'empty':
      setIcon(icon, ICON_IMAGE)
      card.classList.add('md-image-card--muted')
      titleEl.textContent = '未指定图片地址'
      detailEl.textContent = alt ? `替代文本：${alt}` : '把光标移到本行可补全图片地址'
      hintEl.textContent = '点击「图片」按钮可编辑替代文本与地址'
      break

    case 'local': {
      setIcon(icon, ICON_WARNING)
      card.classList.add('md-image-card--warning')
      titleEl.textContent = '浏览器无法访问本地路径'
      detailEl.textContent = showUrl
      detailEl.title = url
      hintEl.textContent = '请改用 http(s) 网络地址、图床链接或 data:image 内联图片'
      break
    }

    case 'unsupported': {
      const info = classifyUrl(url)
      setIcon(icon, ICON_WARNING)
      card.classList.add('md-image-card--warning')
      titleEl.textContent = '不支持的图片地址协议'
      detailEl.textContent = showUrl
      detailEl.title = url
      hintEl.textContent = info.scheme
        ? `未知协议「${info.scheme}:」不会发起请求，请改用 http(s) 地址`
        : '无法识别的地址格式，请检查后重试'
      break
    }

    case 'timeout':
      setIcon(icon, ICON_BROKEN)
      card.classList.add('md-image-card--error')
      titleEl.textContent = '图片加载超时'
      detailEl.textContent = showUrl
      detailEl.title = url
      hintEl.textContent = '网络较慢或地址不可达，可重试且不会改动正文'
      break

    case 'error':
    default:
      setIcon(icon, ICON_BROKEN)
      card.classList.add('md-image-card--error')
      titleEl.textContent = '图片加载失败'
      detailEl.textContent = showUrl || alt || '未知地址'
      detailEl.title = url
      hintEl.textContent = '地址无法访问或不是图片；重试仍对应同一张图片'
      break
  }

  card.appendChild(icon)

  const body = document.createElement('span')
  body.className = 'md-image-card__body'
  body.appendChild(titleEl)
  if (detailEl.textContent) body.appendChild(detailEl)
  if (hintEl.textContent) body.appendChild(hintEl)
  card.appendChild(body)

  if (state.status === 'error' || state.status === 'timeout') {
    appendRetry(card, url)
  }

  wrapper.appendChild(card)
}

function appendRetry(card, url) {
  const actions = document.createElement('span')
  actions.className = 'md-image-card__actions'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'md-image-retry'
  const retryIcon = document.createElement('span')
  retryIcon.className = 'md-image-retry__icon'
  setIcon(retryIcon, ICON_RETRY)
  const label = document.createElement('span')
  label.textContent = '重试'
  btn.appendChild(retryIcon)
  btn.appendChild(label)
  // 同一 URL 重试；注册中心按 URL 复用状态，中断后重试仍是同一张图片
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    retryImage(url)
  })
  actions.appendChild(btn)
  card.appendChild(actions)
}

/**
 * Checkbox Widget for task lists
 */
class CheckboxWidget extends WidgetType {
  constructor(checked) {
    super()
    this.checked = checked
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = `md-task-checkbox${this.checked ? ' md-task-checkbox--checked' : ''}`
    if (!this.checked) {
      span.innerHTML = '&nbsp;'
    }
    return span
  }
  ignoreEvent() { return false }
  eq(other) { return other.checked === this.checked }
}

// Decoration marks
const headingDeco = (level) => Decoration.mark({ class: `md-heading md-heading--${level}` })
const boldDeco = Decoration.mark({ class: 'md-bold' })
const italicDeco = Decoration.mark({ class: 'md-italic' })
const strikeDeco = Decoration.mark({ class: 'md-strikethrough' })
const inlineCodeDeco = Decoration.mark({ class: 'md-inline-code' })
const linkDeco = Decoration.mark({ class: 'md-link' })
const blockquoteDeco = Decoration.mark({ class: 'md-blockquote' })
const syntaxHiddenDeco = Decoration.mark({ class: 'md-syntax-hidden' })
const syntaxVisibleDeco = Decoration.mark({ class: 'md-syntax-visible' })
const codeBlockDeco = Decoration.line({ class: 'md-code-block' })
const listMarkerDeco = Decoration.mark({ class: 'md-list-marker' })
const headingMarkDeco = Decoration.mark({ class: 'md-heading-mark' })

/**
 * Get the line range that the cursor is on.
 * Returns { from, to } of the current line(s) covered by all selections.
 */
function getCursorLineRanges(state) {
  const ranges = []
  for (const sel of state.selection.ranges) {
    const lineFrom = state.doc.lineAt(sel.from)
    const lineTo = state.doc.lineAt(sel.to)
    ranges.push({ from: lineFrom.from, to: lineTo.to })
  }
  return ranges
}

/**
 * Check if a region overlaps with any cursor line range.
 */
function isCursorOnRegion(region, cursorRanges) {
  return cursorRanges.some(cr => region.from <= cr.to && region.to >= cr.from)
}

/**
 * Build decorations for the entire document.
 * Core logic: if cursor is on a region, show syntax marks; otherwise, hide them and show rendered result.
 */
function buildDecorations(view) {
  const { state } = view
  const doc = state.doc.toString()
  const regions = parseMarkdownRegions(doc)
  const cursorRanges = getCursorLineRanges(state)
  const builder = new RangeSetBuilder()

  // We need to collect all decorations and sort them by from position
  const decos = []

  for (const region of regions) {
    const cursorOn = isCursorOnRegion(region, cursorRanges)

    switch (region.type) {
      case 'heading': {
        const { level, markFrom, markTo } = region.meta
        // Always apply heading style to content
        decos.push({ from: region.contentFrom, to: region.to, deco: headingDeco(level) })
        if (cursorOn) {
          // Show the hash marks with special styling
          decos.push({ from: markFrom, to: markTo, deco: headingMarkDeco })
        } else {
          // Hide the hash marks
          decos.push({ from: markFrom, to: markTo, deco: syntaxHiddenDeco })
        }
        break
      }

      case 'bold': {
        // Apply bold to content
        decos.push({ from: region.contentFrom, to: region.contentTo, deco: boldDeco })
        if (!cursorOn) {
          // Hide markers
          decos.push({ from: region.from, to: region.contentFrom, deco: syntaxHiddenDeco })
          decos.push({ from: region.contentTo, to: region.to, deco: syntaxHiddenDeco })
        } else {
          decos.push({ from: region.from, to: region.contentFrom, deco: syntaxVisibleDeco })
          decos.push({ from: region.contentTo, to: region.to, deco: syntaxVisibleDeco })
        }
        break
      }

      case 'italic': {
        decos.push({ from: region.contentFrom, to: region.contentTo, deco: italicDeco })
        if (!cursorOn) {
          decos.push({ from: region.from, to: region.contentFrom, deco: syntaxHiddenDeco })
          decos.push({ from: region.contentTo, to: region.to, deco: syntaxHiddenDeco })
        } else {
          decos.push({ from: region.from, to: region.contentFrom, deco: syntaxVisibleDeco })
          decos.push({ from: region.contentTo, to: region.to, deco: syntaxVisibleDeco })
        }
        break
      }

      case 'strikethrough': {
        decos.push({ from: region.contentFrom, to: region.contentTo, deco: strikeDeco })
        if (!cursorOn) {
          decos.push({ from: region.from, to: region.contentFrom, deco: syntaxHiddenDeco })
          decos.push({ from: region.contentTo, to: region.to, deco: syntaxHiddenDeco })
        } else {
          decos.push({ from: region.from, to: region.contentFrom, deco: syntaxVisibleDeco })
          decos.push({ from: region.contentTo, to: region.to, deco: syntaxVisibleDeco })
        }
        break
      }

      case 'inline-code': {
        decos.push({ from: region.contentFrom, to: region.contentTo, deco: inlineCodeDeco })
        if (!cursorOn) {
          const markerLen = region.meta.markerLen
          decos.push({ from: region.from, to: region.from + markerLen, deco: syntaxHiddenDeco })
          decos.push({ from: region.to - markerLen, to: region.to, deco: syntaxHiddenDeco })
        } else {
          const markerLen = region.meta.markerLen
          decos.push({ from: region.from, to: region.from + markerLen, deco: syntaxVisibleDeco })
          decos.push({ from: region.to - markerLen, to: region.to, deco: syntaxVisibleDeco })
        }
        break
      }

      case 'link': {
        if (!cursorOn) {
          // Show only the link text with link styling
          decos.push({ from: region.contentFrom, to: region.contentTo, deco: linkDeco })
          // Hide [
          decos.push({ from: region.from, to: region.contentFrom, deco: syntaxHiddenDeco })
          // Hide ](url)
          decos.push({ from: region.contentTo, to: region.to, deco: syntaxHiddenDeco })
        } else {
          decos.push({ from: region.contentFrom, to: region.contentTo, deco: linkDeco })
          decos.push({ from: region.from, to: region.contentFrom, deco: syntaxVisibleDeco })
          decos.push({ from: region.contentTo, to: region.to, deco: syntaxVisibleDeco })
        }
        break
      }

      case 'image': {
        if (!cursorOn) {
          // Replace the entire image syntax with a widget
          decos.push({
            from: region.from,
            to: region.to,
            deco: Decoration.replace({
              widget: new ImageWidget(region.meta.alt, region.meta.url)
            })
          })
        }
        // When cursor is on it, show raw syntax (no decoration needed)
        break
      }

      case 'hr': {
        if (!cursorOn) {
          decos.push({
            from: region.from,
            to: region.to,
            deco: Decoration.replace({
              widget: new HrWidget()
            })
          })
        }
        break
      }

      case 'blockquote': {
        const { markFrom, markTo } = region.meta
        decos.push({ from: region.from, to: region.to, deco: blockquoteDeco })
        if (!cursorOn) {
          decos.push({ from: markFrom, to: markTo, deco: syntaxHiddenDeco })
        } else {
          decos.push({ from: markFrom, to: markTo, deco: syntaxVisibleDeco })
        }
        break
      }

      case 'list-bullet': {
        const { markerFrom, markerTo } = region.meta
        decos.push({ from: markerFrom, to: markerTo, deco: listMarkerDeco })
        break
      }

      case 'list-ordered': {
        const { markerFrom, markerTo } = region.meta
        decos.push({ from: markerFrom, to: markerTo, deco: listMarkerDeco })
        break
      }

      case 'task-list': {
        if (!cursorOn) {
          const { checkFrom, checkTo, checked } = region.meta
          decos.push({
            from: checkFrom,
            to: checkTo + 1,
            deco: Decoration.replace({
              widget: new CheckboxWidget(checked)
            })
          })
        }
        break
      }

      case 'code-block': {
        // Apply line decoration to each line in the code block
        const startLine = state.doc.lineAt(region.from)
        const endLine = state.doc.lineAt(region.to)
        for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
          const line = state.doc.line(lineNum)
          decos.push({ from: line.from, to: line.from, deco: codeBlockDeco, isLine: true })
        }
        // Hide fence markers when cursor is not on the block
        if (!cursorOn) {
          const firstLine = state.doc.lineAt(region.from)
          const lastLine = state.doc.lineAt(region.to)
          // Hide opening fence
          decos.push({ from: firstLine.from, to: firstLine.to, deco: syntaxHiddenDeco })
          // Hide closing fence
          decos.push({ from: lastLine.from, to: lastLine.to, deco: syntaxHiddenDeco })
        }
        break
      }
    }
  }

  // Sort decorations by from position, then by whether they are line decorations
  decos.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from
    // Line decorations should come before mark decorations at the same position
    if (a.isLine && !b.isLine) return -1
    if (!a.isLine && b.isLine) return 1
    return 0
  })

  // Filter out invalid ranges (from >= to for non-line decorations)
  for (const d of decos) {
    if (d.isLine) {
      builder.add(d.from, d.from, d.deco)
    } else if (d.from < d.to) {
      builder.add(d.from, d.to, d.deco)
    }
  }

  return builder.finish()
}

/**
 * The main ViewPlugin that drives live markdown rendering.
 */
export const markdownDecorationPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view)
    }

    update(update) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations
  }
)
