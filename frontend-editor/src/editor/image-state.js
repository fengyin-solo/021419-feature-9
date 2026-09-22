/**
 * 图片状态注册中心（模块级单例）。
 *
 * - 按「规范化 URL」共享状态：同一个地址在预览框、正文 widget、重试按钮之间只加载一次。
 * - 状态机：loading → loaded / error / timeout；empty / local / unsupported 为确定性静态状态。
 * - retry(url) 只重试「同一个 URL」，保证中断后重试仍对应同一张图片。
 * - 条目不主动销毁（文档滚动导致 widget 重建时可秒回状态），仅在超出上限时回收空闲条目。
 */
import { initialStatus, canLoad, probeImage } from './image-utils'

const MAX_ENTRIES = 500
const LOAD_TIMEOUT = 10000

// key -> { url, status, kind, error, listeners:Set, seq }
const entries = new Map()

function keyOf(url) {
  return String(url == null ? '' : url).trim()
}

function publish(entry) {
  for (const fn of entry.listeners) {
    try { fn(snapshot(entry)) } catch { /* 监听器异常不影响状态机 */ }
  }
}

function snapshot(entry) {
  return {
    url: entry.url,
    status: entry.status,
    kind: entry.kind,
    error: entry.error || null
  }
}

function startLoad(entry) {
  if (!canLoad(entry.kind)) return
  const seq = ++entry.seq
  entry.status = 'loading'
  entry.error = null
  publish(entry)

  probeImage(entry.url, { timeout: LOAD_TIMEOUT })
    .then(() => {
      // 过期响应（用户已触发新的重试 / 条目被复用）不得覆盖最新状态
      if (seq !== entry.seq) return
      entry.status = 'loaded'
      entry.error = null
      publish(entry)
    })
    .catch((err) => {
      if (seq !== entry.seq) return
      if (err && err.code === 'aborted') return
      entry.status = 'error'
      entry.error = (err && err.code) || 'error'
      publish(entry)
    })
}

function ensureEntry(rawUrl) {
  const key = keyOf(rawUrl)
  let entry = entries.get(key)
  if (entry) {
    // LRU：命中时移到末尾
    entries.delete(key)
    entries.set(key, entry)
    return entry
  }

  const init = initialStatus(key)
  entry = {
    url: key,
    status: init.status,
    kind: init.kind,
    error: null,
    listeners: new Set(),
    seq: 0
  }
  entries.set(key, entry)
  gc()

  if (entry.status === 'loading') startLoad(entry)
  return entry
}

function gc() {
  while (entries.size > MAX_ENTRIES) {
    const oldestKey = entries.keys().next().value
    const oldest = entries.get(oldestKey)
    // 正在加载且仍有监听者的条目不回收
    if (oldest.status === 'loading' && oldest.listeners.size > 0) {
      entries.delete(oldestKey)
      entries.set(oldestKey, oldest)
      break
    }
    entries.delete(oldestKey)
  }
}

/**
 * 订阅某地址的图片状态。返回取消订阅函数。
 * @param {string} url
 * @param {(state:{url:string,status:string,kind:string,error:?string})=>void} listener
 * @returns {() => void}
 */
export function watchImage(url, listener) {
  const entry = ensureEntry(url)
  entry.listeners.add(listener)
  listener(snapshot(entry))
  return () => {
    entry.listeners.delete(listener)
  }
}

/**
 * 预览成功后预置状态：对话框确认插入后，正文可直接显示图片而不重复探测。
 */
export function primeLoaded(url) {
  const entry = ensureEntry(url)
  entry.seq++ // 使任何在途请求失效
  entry.status = 'loaded'
  entry.error = null
  publish(entry)
}

/**
 * 重试同一地址的图片。返回当前快照。
 * 仅对可加载的分类（remote / protocol-relative / data / relative）有效；
 * 若上一次请求仍在途（如被超时判定前），也会作废它并重新发起，
 * 保证「中断后重试」始终对应同一张图片。
 */
export function retryImage(url) {
  const entry = ensureEntry(url)
  if (canLoad(entry.kind)) startLoad(entry)
  return snapshot(entry)
}

/**
 * 读取某地址的当前状态（不触发订阅）。
 */
export function getImageState(url) {
  const entry = ensureEntry(url)
  return snapshot(entry)
}
