<template>
  <div class="app">
    <Toolbar @action="handleToolbarAction" />
    <EditorPane ref="editorPane" @ready="onEditorReady" />
    <StatusBar />
    <ImageDialog
      :visible="imageDialog.visible"
      :mode="imageDialog.mode"
      :initial-alt="imageDialog.alt"
      :initial-url="imageDialog.url"
      @confirm="confirmImage"
      @cancel="imageDialog.visible = false"
    />
    <Transition name="toast">
      <div v-if="toast.visible" :class="['toast', `toast--${toast.type}`]">
        {{ toast.message }}
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import Toolbar from '@/components/Toolbar.vue'
import EditorPane from '@/components/EditorPane.vue'
import StatusBar from '@/components/StatusBar.vue'
import ImageDialog from '@/components/ImageDialog.vue'
import { parseMarkdownRegions } from '@/editor/markdown-parser'
import { useEditorStore } from '@/stores/editor'

const editorPane = ref(null)
const store = useEditorStore()
let editorView = null

const toast = reactive({ visible: false, message: '', type: 'info' })
let toastTimer = null

function showToast(msg, type = 'info') {
  toast.message = msg; toast.type = type; toast.visible = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.visible = false }, 2000)
}

function onEditorReady(view) { editorView = view }

// === 图片插入 / 编辑 ===
// 对话框为单例：重复点击工具栏按钮不会重复打开，也不会重复插入
const imageDialog = reactive({
  visible: false,
  mode: 'insert', // 'insert' | 'edit'
  alt: '',
  url: '',
  title: '', // 编辑模式保留原有 title，替换时原样写回，保证无损
  from: 0,
  to: 0
})

function openImageDialog() {
  if (!editorView || imageDialog.visible) return
  const { state } = editorView
  const { from, to } = state.selection.main

  // 光标或选区落在已有图片语法上 → 编辑模式：预填并原位替换，避免嵌套破坏正文
  const region = parseMarkdownRegions(state.doc.toString()).find(
    (r) => r.type === 'image' && r.from <= to && r.to >= from
  )

  if (region) {
    Object.assign(imageDialog, {
      visible: true,
      mode: 'edit',
      alt: region.meta.alt,
      url: region.meta.url,
      title: region.meta.title || '',
      from: region.from,
      to: region.to
    })
  } else {
    // 选中文本保留为替代文本，不会被丢弃
    const sel = state.sliceDoc(from, to)
    Object.assign(imageDialog, {
      visible: true,
      mode: 'insert',
      alt: sel,
      url: '',
      title: '',
      from,
      to
    })
  }
}

function confirmImage({ alt, url }) {
  imageDialog.visible = false
  if (!editorView) return
  const docLen = editorView.state.doc.length
  // 对话框打开期间文档可能被外部改动，做边界保护
  const from = Math.min(imageDialog.from, docLen)
  const to = Math.min(imageDialog.to, docLen)
  const title = imageDialog.title ? ` ${imageDialog.title}` : ''
  const text = `![${alt}](${url}${title})`
  editorView.dispatch({
    changes: { from, to, insert: text },
    // 光标移到语法之后：离开该行即触发渲染，预览与正文即刻同步
    selection: { anchor: from + text.length }
  })
  editorView.focus()
}

// === 保存 ===
function onGlobalKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    store.markSaved()
    showToast('已保存', 'success')
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown))

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
