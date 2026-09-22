<template>
  <div class="app">
    <Toolbar @action="handleToolbarAction" />
    <EditorPane ref="editorPane" @ready="onEditorReady" />
    <StatusBar />
    <ImageDialog ref="imageDialog" @confirm="handleImageConfirm" @cancel="onImageCancel" />
    <Transition name="toast">
      <div v-if="toast.visible" :class="['toast', `toast--${toast.type}`]">
        {{ toast.message }}
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import Toolbar from '@/components/Toolbar.vue'
import EditorPane from '@/components/EditorPane.vue'
import StatusBar from '@/components/StatusBar.vue'
import ImageDialog from '@/components/ImageDialog.vue'
import { parseMarkdownRegions } from '@/editor'
import { escapeAlt, formatDestination } from '@/editor/image-utils'

const editorPane = ref(null)
const imageDialog = ref(null)
let editorView = null

/** 图片对话框单例守卫：打开期间忽略重复的「图片」操作，杜绝重复插入 */
const imageDialogOpen = ref(false)
/** 当前对话框对应的编辑目标；插入模式记录插入锚点，编辑模式记录原图片区间 */
let imageEditTarget = null

const toast = reactive({ visible: false, message: '', type: 'info' })
let toastTimer = null

function showToast(msg, type = 'info') {
  toast.message = msg; toast.type = type; toast.visible = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.visible = false }, 2000)
}

function onEditorReady(view) { editorView = view }

function insertText(before, after = '') {
  if (!editorView) return
  const { from, to } = editorView.state.selection.main
  const sel = editorView.state.sliceDoc(from, to)
  const text = `${before}${sel || 'text'}${after}`
  editorView.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + before.length, head: from + before.length + (sel || 'text').length }
  })
  editorView.focus()
}

function insertLine(prefix) {
  if (!editorView) return
  const line = editorView.state.doc.lineAt(editorView.state.selection.main.head)
  editorView.dispatch({ changes: { from: line.from, to: line.from, insert: prefix } })
  editorView.focus()
}

/**
 * 找到主选区所在的图片语法区间（选区完全落在区间内才算）。
 */
function findImageRegion(doc, from, to) {
  const regions = parseMarkdownRegions(doc)
  return regions.find(r => r.type === 'image' && from >= r.from && to <= r.to) || null
}

/**
 * 打开图片对话框：
 * - 光标（或选区）位于已有图片内 → 编辑模式，回填 alt / url，替换原区间
 * - 有选中文本 → 选中文本原样保留为替代文本
 * - 仅光标 → 在光标处插入，不改动任何正文；取消则文档零变化
 */
function openImageDialog() {
  if (!editorView || imageDialogOpen.value) return
  const { from, to } = editorView.state.selection.main
  const doc = editorView.state.doc.toString()
  const selected = from !== to ? editorView.state.sliceDoc(from, to) : ''
  const region = findImageRegion(doc, from, to)

  if (region) {
    imageEditTarget = { type: 'edit', from: region.from, to: region.to }
    imageDialogOpen.value = true
    imageDialog.value.open({
      mode: 'edit',
      alt: region.meta.alt || '',
      url: region.meta.url || ''
    })
    return
  }

  // 立即记录选区作为插入锚点，对话框打开期间即使编辑器失焦也能插回原位，
  // 选中文本原样保留为替代文本；仅光标时不改动任何正文。
  imageEditTarget = { type: 'insert', from, to }
  imageDialogOpen.value = true
  imageDialog.value.open({
    mode: 'insert',
    alt: selected,
    url: ''
  })
}

function onImageCancel() {
  imageDialogOpen.value = false
  imageEditTarget = null
}

/**
 * 确认插入 / 保存修改。无论地址是否可访问，语法都安全写入文档；
 * 渲染层的可恢复状态由 ImageWidget + image-state 负责，不影响正文。
 */
function handleImageConfirm(payload) {
  if (!editorView) {
    imageDialogOpen.value = false
    return
  }
  imageDialogOpen.value = false

  const altText = escapeAlt(payload.alt || '')
  const dest = formatDestination(payload.url)
  const syntax = `![${altText}](${dest})`

  const target = imageEditTarget
  imageEditTarget = null

  if (target) {
    editorView.dispatch({
      changes: { from: target.from, to: target.to, insert: syntax },
      selection: { anchor: target.from + syntax.length }
    })
    showToast(target.type === 'edit' ? '图片已更新' : '图片已插入', 'success')
  } else {
    // 理论上不会发生（打开时即记录锚点）；兜底回到当前光标
    const { from, to } = editorView.state.selection.main
    editorView.dispatch({
      changes: { from, to, insert: syntax },
      selection: { anchor: from + syntax.length }
    })
    showToast('图片已插入', 'success')
  }
  editorView.focus()
}

function handleToolbarAction(action) {
  const map = {
    bold: () => insertText('**', '**'),
    italic: () => insertText('*', '*'),
    strikethrough: () => insertText('~~', '~~'),
    code: () => insertText('`', '`'),
    link: () => insertText('[', '](url)'),
    image: openImageDialog,
    blockquote: () => insertLine('> '),
    'bullet-list': () => insertLine('- '),
    'ordered-list': () => insertLine('1. '),
    hr: () => {
      const pos = editorView.state.selection.main.head
      const line = editorView.state.doc.lineAt(pos)
      editorView.dispatch({ changes: { from: line.to, to: line.to, insert: '\n\n---\n\n' } })
      editorView.focus()
    },
  }
  const fn = map[action]
  fn ? fn() : showToast(`未知操作: ${action}`, 'warning')
}
</script>

<style lang="scss" scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: $bg;
}

.toast {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  padding: $sp-2 $sp-5;
  border-radius: $r-full;
  font-size: $fs-sm;
  color: #fff;
  z-index: $z-toast;
  box-shadow: $shadow-lg;
  pointer-events: none;
  font-family: $font-ui;

  &--info { background: $accent; }
  &--success { background: $success; }
  &--warning { background: $warning; }
  &--error { background: $error; }
}

.toast-enter-active,
.toast-leave-active {
  transition: all $t-slow $ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
