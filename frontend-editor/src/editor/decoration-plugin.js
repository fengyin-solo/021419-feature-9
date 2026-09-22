import {
  ViewPlugin,
  Decoration,
  WidgetType
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { parseMarkdownRegions } from './markdown-parser'
import { classifyImageUrl, canAttemptLoad } from './image-url'

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

/** 图片加载超时时间（ms），超时后进入可重试的超时态 */
const IMAGE_LOAD_TIMEOUT = 15000

// 静态 SVG 图标（常量字符串，不含用户输入，可安全使用 innerHTML）
const ICONS = {
  image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function iconSpan(name) {
  const span = document.createElement('span')
  span.className = 'md-image-icon'
  span.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
  return span
}

/**
 * Image Widget — 图片预览，带完整的状态机：
 * loading → loaded / error / timeout（可重试）
 * empty / local / unknown-protocol（提示态，均不改动正文）
 *
 * 正文始终保留原始 Markdown，本 widget 只是视觉层；
 * 任何状态下把光标移入该行即可看到并编辑原始语法。
 */
class ImageWidget extends WidgetType {
  constructor(alt, url) {
    super()
    this.alt = alt
    this.url = url
    // 加载尝试序号：超时/重试后使旧的异步回调失效，
    // 保证任何时刻只有最新一次尝试能改写 DOM（重试仍对应同一 url）
    this.attempt = 0
    this.timer = null
  }

  eq(other) { return other.url === this.url && other.alt === this.alt }

  toDOM() {
    const { kind, protocol } = classifyImageUrl(this.url)

    // 不尝试加载的分类：直接渲染对应的可恢复提示态
    if (!canAttemptLoad(kind)) {
      return this.renderNotice(kind, protocol)
    }

    const wrapper = el('span', 'md-image-box')
    this.startLoad(wrapper)
    return wrapper
  }

  /**
   * 发起一次加载尝试。重试时复用同一 this.url —— 始终对应同一张图片。
   */
  startLoad(wrapper) {
    this.clearTimer()
    const attempt = ++this.attempt
    const url = this.url // 固定引用，本次尝试（含超时中断后的重试）都加载同一地址

    // 加载态
    wrapper.className = 'md-image-box md-image-box--loading'
    const loading = el('span', 'md-image-status')
    loading.appendChild(el('span', 'md-image-spinner'))
    loading.appendChild(el('span', 'md-image-status-text', '图片加载中…'))
    if (this.alt) loading.appendChild(el('span', 'md-image-status-alt', this.alt))
    wrapper.replaceChildren(loading)

    const img = new Image()
    img.alt = this.alt || ''
    img.className = 'md-image-widget'

    const stale = () => attempt !== this.attempt || !wrapper.isConnected

    img.onload = () => {
      if (stale()) return
      this.clearTimer()
      wrapper.className = 'md-image-box'
      wrapper.replaceChildren(img)
    }
    img.onerror = () => {
      if (stale()) return
      this.clearTimer()
      this.renderRetryable(wrapper, 'error')
    }

    // 网络超时：中断本次请求，进入可重试的超时态
    this.timer = setTimeout(() => {
      if (stale()) return
      img.onload = null
      img.onerror = null
      img.src = '' // 中断挂起的请求；重试时重新加载同一 url
      this.renderRetryable(wrapper, 'timeout')
    }, IMAGE_LOAD_TIMEOUT)

    img.src = url
  }

  /**
   * 失败 / 超时态：展示原因 + 重试按钮（重试仍加载同一地址）。
   */
  renderRetryable(wrapper, reason) {
    this.clearTimer()
    wrapper.className = `md-image-box md-image-box--${reason}`

    const box = el('span', 'md-image-notice')
    const head = el('span', 'md-image-notice-head')
    head.appendChild(iconSpan('image'))
    head.appendChild(el('span', 'md-image-notice-title',
      reason === 'timeout' ? '图片加载超时' : '图片加载失败'))
    box.appendChild(head)

    box.appendChild(el('span', 'md-image-notice-url', this.url))
    box.appendChild(el('span', 'md-image-notice-hint',
      '将光标移入本行可修改地址；修改后预览会自动刷新'))

    const retryBtn = el('button', 'md-image-action', '重试')
    retryBtn.type = 'button'
    retryBtn.addEventListener('mousedown', (e) => e.preventDefault())
    retryBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (wrapper.isConnected) this.startLoad(wrapper)
    })
    box.appendChild(retryBtn)

    wrapper.replaceChildren(box)
  }

  /**
   * 空态 / 本地路径 / 未知协议：不发起请求，仅给出说明与恢复路径。
   */
  renderNotice(kind, protocol) {
    const wrapper = el('span', `md-image-box md-image-box--${kind}`)
    const box = el('span', 'md-image-notice')

    const head = el('span', 'md-image-notice-head')
    head.appendChild(iconSpan(kind === 'empty' ? 'image' : 'warning'))

    let title, hint
    if (kind === 'empty') {
      title = '未填写图片地址'
      hint = '将光标移入本行，在 !( ) 中填写图片地址'
    } else if (kind === 'local') {
      title = '浏览器无法访问本地路径'
      hint = '请使用 http(s):// 网络地址，或将图片托管后引用'
    } else {
      title = `不支持的协议：${protocol}:`
      hint = '请使用 http(s)://、data:image/ 或 blob: 地址'
    }
    head.appendChild(el('span', 'md-image-notice-title', title))
    box.appendChild(head)

    if (this.url) box.appendChild(el('span', 'md-image-notice-url', this.url))
    if (this.alt) box.appendChild(el('span', 'md-image-notice-alt', `替代文本：${this.alt}`))
    box.appendChild(el('span', 'md-image-notice-hint', hint))

    wrapper.appendChild(box)
    return wrapper
  }

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** 让重试按钮的点击事件由 widget 自己处理，不被编辑器吞掉 */
  ignoreEvent(event) {
    return !!event.target?.closest?.('.md-image-action')
  }

  destroy() {
    this.clearTimer()
    this.attempt++ // 使所有进行中的异步回调失效
  }
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
