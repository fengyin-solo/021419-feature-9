<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="dialog-mask" @mousedown.self="onCancel">
        <div class="dialog" role="dialog" aria-modal="true" @keydown.esc.stop="onCancel">
          <header class="dialog__header">
            <span class="dialog__title">{{ mode === 'edit' ? '编辑图片' : '插入图片' }}</span>
            <button type="button" class="dialog__close" title="关闭" @click="onCancel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </header>

          <div class="dialog__body">
            <label class="dialog__field">
              <span class="dialog__label">替代文本</span>
              <input
                ref="altInput"
                v-model="alt"
                class="dialog__input"
                :class="{ 'dialog__input--error': altCheck.level === 'error' }"
                type="text"
                placeholder="图片无法显示时的替代文字"
                spellcheck="false"
                @keydown.enter.prevent="onConfirm"
              />
              <span v-if="altCheck.message" class="dialog__msg dialog__msg--error">{{ altCheck.message }}</span>
            </label>

            <label class="dialog__field">
              <span class="dialog__label">图片地址</span>
              <input
                ref="urlInput"
                v-model="url"
                class="dialog__input dialog__input--mono"
                :class="{ 'dialog__input--error': urlCheck.level === 'error' }"
                type="text"
                placeholder="https://example.com/image.png"
                spellcheck="false"
                @keydown.enter.prevent="onConfirm"
              />
              <span
                v-if="urlCheck.message"
                class="dialog__msg"
                :class="`dialog__msg--${urlCheck.level === 'none' ? 'info' : urlCheck.level}`"
              >{{ urlCheck.message }}</span>
            </label>
          </div>

          <footer class="dialog__footer">
            <button type="button" class="dialog__btn" @click="onCancel">取消</button>
            <button
              type="button"
              class="dialog__btn dialog__btn--primary"
              :disabled="!canSubmit"
              @click="onConfirm"
            >{{ mode === 'edit' ? '保存' : '插入' }}</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { validateImageUrl, validateAltText } from '@/editor/image-url'

const props = defineProps({
  visible: { type: Boolean, default: false },
  mode: { type: String, default: 'insert' }, // 'insert' | 'edit'
  initialAlt: { type: String, default: '' },
  initialUrl: { type: String, default: '' }
})

const emit = defineEmits(['confirm', 'cancel'])

const alt = ref('')
const url = ref('')
const altInput = ref(null)
const urlInput = ref(null)

const altCheck = computed(() => validateAltText(alt.value))
const urlCheck = computed(() => validateImageUrl(url.value))
// error 级禁止提交（会生成破碎语法）；warning 级允许提交，预览层展示对应状态
const canSubmit = computed(() => altCheck.value.ok && urlCheck.value.ok)

watch(() => props.visible, async (v) => {
  if (!v) return
  alt.value = props.initialAlt
  url.value = props.initialUrl
  await nextTick()
  // 编辑模式或已有替代文本时聚焦地址框，否则聚焦替代文本框
  const target = (props.mode === 'edit' || !props.initialAlt) ? urlInput.value : altInput.value
  target?.focus()
  target?.select()
})

function onConfirm() {
  if (!canSubmit.value) return
  emit('confirm', { alt: alt.value.trim(), url: url.value.trim() })
}

function onCancel() {
  emit('cancel')
}
</script>

<style lang="scss" scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  background: rgba(28, 25, 23, 0.32);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 18vh;
  z-index: $z-dialog;
}

.dialog {
  width: 420px;
  max-width: calc(100vw - 32px);
  background: $bg-elevated;
  border-radius: $r-lg;
  box-shadow: $shadow-lg;
  border: 1px solid $border-light;
  overflow: hidden;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: $sp-4 $sp-5 $sp-2;
  }

  &__title {
    font-size: $fs-sm;
    font-weight: 600;
    color: $text;
  }

  &__close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    border-radius: $r-sm;
    color: $text-3;
    cursor: pointer;
    transition: all $t-fast $ease;

    &:hover { background: $accent-soft; color: $accent; }
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: $sp-4;
    padding: $sp-3 $sp-5 $sp-4;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: $sp-1;
  }

  &__label {
    font-size: $fs-xs;
    color: $text-2;
    font-weight: 500;
  }

  &__input {
    height: 34px;
    padding: 0 $sp-3;
    border: 1px solid $border;
    border-radius: $r-md;
    font-size: $fs-sm;
    font-family: $font-ui;
    color: $text;
    background: $bg;
    outline: none;
    transition: border-color $t-fast $ease, box-shadow $t-fast $ease;

    &:focus {
      border-color: $accent;
      box-shadow: 0 0 0 3px $accent-soft;
      background: $bg-elevated;
    }

    &--mono { font-family: $font-mono; font-size: $fs-xs; }

    &--error,
    &--error:focus {
      border-color: $error;
      box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.08);
    }
  }

  &__msg {
    font-size: $fs-xs;
    line-height: 1.5;

    &--error { color: $error; }
    &--warning { color: $warning; }
    &--info { color: $text-3; }
  }

  &__footer {
    display: flex;
    justify-content: flex-end;
    gap: $sp-2;
    padding: $sp-3 $sp-5 $sp-4;
    border-top: 1px solid $border-light;
  }

  &__btn {
    height: 30px;
    padding: 0 $sp-4;
    border: 1px solid $border;
    border-radius: $r-md;
    background: $bg-elevated;
    font-size: $fs-xs;
    font-weight: 500;
    color: $text-2;
    cursor: pointer;
    transition: all $t-fast $ease;

    &:hover { border-color: $text-3; color: $text; }

    &--primary {
      background: $accent;
      border-color: $accent;
      color: #fff;

      &:hover { background: darken($accent, 6%); border-color: $accent; color: #fff; }
      &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        &:hover { background: $accent; }
      }
    }
  }
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity $t-normal $ease;
  .dialog { transition: transform $t-normal $ease, opacity $t-normal $ease; }
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
  .dialog { transform: translateY(-8px) scale(0.98); opacity: 0; }
}
</style>
