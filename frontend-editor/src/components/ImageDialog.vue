<template>
  <Teleport to="body">
    <Transition name="img-dialog">
      <div
        v-if="open"
        class="img-dialog__overlay"
        @mousedown.self="handleCancel"
      >
        <div
          class="img-dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="mode === 'edit' ? '编辑图片' : '插入图片'"
        >
          <header class="img-dialog__header">
            <h3 class="img-dialog__title">{{ mode === 'edit' ? '编辑图片' : '插入图片' }}</h3>
            <button
              type="button"
              class="img-dialog__close"
              title="关闭 (Esc)"
              @click="handleCancel"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </header>

          <div class="img-dialog__body">
            <label class="img-field">
              <span class="img-field__label">替代文本</span>
              <input
                ref="altInput"
                v-model="alt"
                type="text"
                class="img-field__input"
                placeholder="描述图片内容（读屏器与加载失败时展示）"
                @keydown.esc.stop="handleCancel"
              />
            </label>

            <label class="img-field">
              <span class="img-field__label">
                图片地址
                <span
                  v-if="urlHint"
                  class="img-field__hint"
                  :class="`img-field__hint--${urlHint.tone}`"
                >{{ urlHint.text }}</span>
              </span>
              <input
                ref="urlInput"
                v-model="url"
                type="text"
                class="img-field__input"
                :class="{ 'img-field__input--error': showUrlRequired }"
                placeholder="https://example.com/image.png"
                spellcheck="false"
                @keydown.enter.prevent="handleConfirm"
                @keydown.esc.stop="handleCancel"
              >
              <span v-if="showUrlRequired" class="img-field__error">请输入图片地址</span>
            </label>

            <div class="img-preview">
              <span class="img-preview__label">预览</span>
              <div class="img-preview__stage" :class="`is-${preview.status}`">
                <template v-if="preview.status === 'idle'">
                  <span class="img-preview__placeholder">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    <span>输入图片地址后在此预览</span>
                  </span>
                </template>

                <template v-else-if="preview.status === 'loading'">
                  <span class="img-preview__loading">
                    <span class="md-image-spinner" />
                    <span>正在加载…</span>
                  </span>
                </template>

                <template v-else-if="preview.status === 'loaded'">
                  <img
                    :src="resolvedUrl"
                    :alt="alt"
                    class="img-preview__img"
                    referrerpolicy="no-referrer"
                  >
                </template>

                <template v-else>
                  <span class="img-preview__message">
                    <svg v-if="preview.tone === 'warning'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    <span class="img-preview__message-title">{{ preview.title }}</span>
                    <span v-if="preview.detail" class="img-preview__message-detail">{{ preview.detail }}</span>
                    <button
                      v-if="preview.retryable"
                      type="button"
                      class="md-image-retry img-preview__retry"
                      @click="retryPreview"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                      <span>重试</span>
                    </button>
                  </span>
                </template>
              </div>
            </div>
          </div>

          <footer class="img-dialog__footer">
            <button type="button" class="img-btn img-btn--ghost" @click="handleCancel">
              取消
            </button>
            <button
              type="button"
              class="img-btn img-btn--primary"
              :disabled="!canConfirm || busy"
              @click="handleConfirm"
            >
              {{ mode === 'edit' ? '保存修改' : '插入图片' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { classifyUrl, probeImage } from '@/editor/image-utils'
import { primeLoaded } from '@/editor/image-state'

const emit = defineEmits(['confirm', 'cancel'])

const open = ref(false)
const busy = ref(false)
const mode = ref('insert') // 'insert' | 'edit'
const alt = ref('')
const url = ref('')
const altInput = ref(null)
const urlInput = ref(null)

/**
 * 预览状态机（对话框私有，不复用注册中心，避免输入过程污染正文状态）。
 */
const preview = reactive({
  status: 'idle', // idle | loading | loaded | error | timeout | empty | local | unsupported
  tone: 'muted',
  title: '',
  detail: '',
  retryable: false
})

const trimmedUrl = computed(() => url.value.trim())

const urlInfo = computed(() => classifyUrl(trimmedUrl.value))

/**
 * 地址栏的内联提示（不阻断插入）。空地址在点击确认时才报错。
 */
const urlHint = computed(() => {
  const info = urlInfo.value
  if (!trimmedUrl.value) return null
  switch (info.kind) {
    case 'remote':
    case 'protocol-relative':
    case 'data':
      return null
    case 'relative':
      return { tone: 'muted', text: '相对地址：将按当前页面解析' }
    case 'local':
      return { tone: 'warning', text: '本地路径在浏览器中无法访问' }
    case 'unknown-scheme':
      return { tone: 'warning', text: `未知协议「${info.scheme || '?'}:」不会发起请求` }
    default:
      return null
  }
})

const urlTouched = ref(false)

const urlError = computed(() => (urlTouched.value && !trimmedUrl.value) ? '请输入图片地址' : '')
const showUrlRequired = computed(() => !!urlError.value)

const canConfirm = computed(() => trimmedUrl.value.length > 0)

/** 相对地址用浏览器基准解析后再加载；其余地址原样使用 */
const resolvedUrl = computed(() => {
  const u = trimmedUrl.value
  if (!u) return u
  try {
    return new URL(u, window.location.href).href
  } catch {
    return u
  }
})

// —— 预览探测：防抖 + 中断，地址修改后预览立即跟随，旧请求结果作废 ——
let probeSeq = 0
let probeController = null
let debounceTimer = null

function resetPreview() {
  preview.status = 'idle'
  preview.tone = 'muted'
  preview.title = ''
  preview.detail = ''
  preview.retryable = false
}

function applyFailure(code, info) {
  if (code === 'timeout') {
    preview.status = 'timeout'
    preview.tone = 'error'
    preview.title = '加载超时'
    preview.detail = '网络较慢或地址不可达，可重试'
    preview.retryable = true
  } else if (info.kind === 'empty') {
    preview.status = 'empty'
    preview.tone = 'muted'
    preview.title = '未指定图片地址'
    preview.detail = ''
    preview.retryable = false
  } else if (info.kind === 'local') {
    preview.status = 'local'
    preview.tone = 'warning'
    preview.title = '浏览器无法访问本地路径'
    preview.detail = '请改用 http(s) 网络地址或 data:image 内联图片'
    preview.retryable = false
  } else if (info.kind === 'unknown-scheme') {
    preview.status = 'unsupported'
    preview.tone = 'warning'
    preview.title = '不支持的图片地址协议'
    preview.detail = info.scheme ? `未知协议「${info.scheme}:」` : '无法识别的地址格式'
    preview.retryable = false
  } else {
    preview.status = 'error'
    preview.tone = 'error'
    preview.title = '图片加载失败'
    preview.detail = '地址无法访问或不是图片资源'
    preview.retryable = true
  }
}

function scheduleProbe(immediate = false) {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (probeController) {
    probeController.abort()
    probeController = null
  }

  const info = urlInfo.value
  const target = trimmedUrl.value

  if (!target) { resetPreview(); return }
  if (info.kind === 'local' || info.kind === 'unknown-scheme' || info.kind === 'empty') {
    applyFailure(info.kind === 'empty' ? '' : 'static', info)
    return
  }

  preview.status = 'loading'
  const seq = ++probeSeq
  const targetUrl = resolvedUrl.value

  const run = () => {
    const controller = new AbortController()
    probeController = controller
    probeImage(targetUrl, { signal: controller.signal })
      .then(() => {
        if (seq !== probeSeq) return
        preview.status = 'loaded'
        preview.tone = 'ok'
        preview.retryable = false
      })
      .catch((err) => {
        if (seq !== probeSeq) return
        if (err && err.code === 'aborted') return
        applyFailure((err && err.code) || 'error', classifyUrl(target))
      })
  }

  if (immediate) run()
  else debounceTimer = setTimeout(run, 350)
}

watch(url, () => {
  urlTouched.value = true
  scheduleProbe(false)
})
// alt 变化只影响替代文本与最终语法，无需重新探测

function retryPreview() {
  scheduleProbe(true)
}

/**
 * 打开对话框。
 * @param {object} opts
 * @param {'insert'|'edit'} [opts.mode]
 * @param {string} [opts.alt]
 * @param {string} [opts.url]
 */
async function openDialog(opts = {}) {
  busy.value = false
  mode.value = opts.mode === 'edit' ? 'edit' : 'insert'
  alt.value = opts.alt || ''
  url.value = opts.url || ''
  urlTouched.value = !!opts.url
  open.value = true
  resetPreview()
  await nextTick()
  if (mode.value === 'insert' && !alt.value) {
    altInput.value?.focus()
  } else {
    urlInput.value?.focus()
    urlInput.value?.select()
  }
  if (trimmedUrl.value) scheduleProbe(true)
}

function close() {
  open.value = false
  if (debounceTimer) clearTimeout(debounceTimer)
  if (probeController) {
    probeController.abort()
    probeController = null
  }
  probeSeq++
}

function handleCancel() {
  if (busy.value) return
  close()
  emit('cancel')
}

function handleConfirm() {
  if (busy.value) return
  if (!canConfirm.value) {
    urlInput.value?.focus()
    return
  }
  busy.value = true
  const payload = {
    mode: mode.value,
    alt: alt.value,
    url: trimmedUrl.value,
    previewOk: preview.status === 'loaded'
  }
  // 预览已加载成功 → 预置注册中心状态，正文渲染区直接显示，不再重复探测
  if (payload.previewOk) primeLoaded(trimmedUrl.value)
  close()
  busy.value = false
  emit('confirm', payload)
}

function onKeydown(e) {
  if (!open.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    handleCancel()
  }
}

watch(open, (v) => {
  if (v) window.addEventListener('keydown', onKeydown, true)
  else window.removeEventListener('keydown', onKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (debounceTimer) clearTimeout(debounceTimer)
  if (probeController) probeController.abort()
})

defineExpose({ open: openDialog })
</script>

<style lang="scss" scoped>
.img-dialog__overlay {
  position: fixed;
  inset: 0;
  background: rgba(28, 25, 23, 0.32);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: $z-modal;
  padding: $sp-4;
}

.img-dialog {
  width: 480px;
  max-width: 100%;
  background: $bg-elevated;
  border-radius: $r-lg;
  box-shadow: $shadow-lg;
  border: 1px solid $border-light;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: $sp-3 $sp-4;
    border-bottom: 1px solid $border-light;
  }

  &__title {
    font-family: $font-ui;
    font-size: $fs-base;
    font-weight: 600;
    color: $text;
    margin: 0;
  }

  &__close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    border-radius: $r-md;
    color: $text-3;
    cursor: pointer;
    transition: all $t-fast $ease;
    &:hover { background: $bg-code; color: $text; }
  }

  &__body {
    padding: $sp-4;
    display: flex;
    flex-direction: column;
    gap: $sp-3;
  }

  &__footer {
    display: flex;
    justify-content: flex-end;
    gap: $sp-2;
    padding: $sp-3 $sp-4;
    border-top: 1px solid $border-light;
    background: $bg;
  }
}

.img-field {
  display: flex;
  flex-direction: column;
  gap: 5px;

  &__label {
    display: flex;
    align-items: center;
    gap: $sp-2;
    font-size: $fs-sm;
    font-weight: 500;
    color: $text-2;
  }

  &__hint {
    font-size: $fs-xs;
    font-weight: 400;

    &--muted { color: $text-3; }
    &--warning { color: $warning; }
    &--error { color: $error; }
  }

  &__input {
    width: 100%;
    height: 34px;
    padding: 0 $sp-3;
    border: 1px solid $border;
    border-radius: $r-md;
    font-family: $font-mono;
    font-size: $fs-sm;
    color: $text;
    background: $bg-editor;
    transition: border-color $t-fast $ease, box-shadow $t-fast $ease;

    &:focus {
      outline: none;
      border-color: $accent;
      box-shadow: 0 0 0 3px $accent-soft;
    }

    &--error {
      border-color: $error;
    }
  }

  &__error {
    font-size: $fs-xs;
    color: $error;
  }
}

.img-preview {
  display: flex;
  flex-direction: column;
  gap: 5px;

  &__label {
    font-size: $fs-sm;
    font-weight: 500;
    color: $text-2;
  }

  &__stage {
    min-height: 140px;
    max-height: 240px;
    border: 1px solid $border;
    border-radius: $r-md;
    background: $bg;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: $sp-3;

    &.is-loaded { padding: 0; background: $bg-code; }
    &.is-loading, &.is-idle { border-style: dashed; color: $text-3; }
    &.is-error, &.is-timeout { border-color: rgba(220, 38, 38, 0.35); background: rgba(220, 38, 38, 0.04); }
    &.is-local, &.is-unsupported { border-color: rgba(217, 119, 6, 0.35); background: rgba(217, 119, 6, 0.05); color: $warning; }
  }

  &__img {
    max-width: 100%;
    max-height: 240px;
    object-fit: contain;
    display: block;
  }

  &__placeholder,
  &__loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: $sp-2;
    font-size: $fs-sm;
    color: $text-3;
  }

  &__message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    text-align: center;
    font-size: $fs-sm;
    padding: $sp-2;

    svg { flex-shrink: 0; }
  }

  &__message-title { font-weight: 500; }

  &__message-detail {
    font-size: $fs-xs;
    color: $text-3;
    word-break: break-all;
  }

  &__retry { margin-top: 4px; }
}

.img-btn {
  height: 32px;
  padding: 0 $sp-4;
  border-radius: $r-md;
  font-size: $fs-sm;
  font-weight: 500;
  cursor: pointer;
  transition: all $t-fast $ease;
  border: 1px solid transparent;

  &--ghost {
    background: transparent;
    border-color: $border;
    color: $text-2;
    &:hover { background: $bg-code; color: $text; }
  }

  &--primary {
    background: $accent;
    color: #fff;
    &:hover:not(:disabled) { background: darken($accent, 6%); }
    &:disabled { opacity: 0.45; cursor: not-allowed; }
  }
}

.img-dialog-enter-active,
.img-dialog-leave-active {
  transition: opacity $t-fast $ease;
  .img-dialog {
    transition: transform $t-normal $ease, opacity $t-fast $ease;
  }
}
.img-dialog-enter-from,
.img-dialog-leave-to {
  opacity: 0;
  .img-dialog {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
}
</style>
