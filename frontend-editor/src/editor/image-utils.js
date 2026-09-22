/**
 * 图片地址相关的纯工具：地址分类、Markdown 转义、带超时/中断的加载探测。
 * 这些函数不依赖 DOM 之外的运行环境（probeImage 依赖 Image），也不修改编辑器文档，
 * 因此任何「未知地址 / 未知协议 / 超时」都只会得到一个分类结果，绝不会破坏正文。
 */

/**
 * 地址分类：
 * - empty            空地址（![alt]()）
 * - remote           http(s) 绝对地址
 * - protocol-relative 协议相对地址（//example.com/a.png）
 * - data             data: 内联图片（data:image/...）
 * - local            浏览器注定无法直接访问的本地文件系统路径
 * - unknown-scheme   未知 / 不允许的协议（如 javascript:、vbscript:、ftp:）
 * - relative         其余按相对路径处理（/abs、./x、../x、bare.png），交给浏览器解析
 */
export function classifyUrl(rawUrl) {
  const url = (rawUrl || '').trim()
  if (!url) return { kind: 'empty', url }

  // data: URI（base64 内联图片是合法且可渲染的）
  if (/^data:image\//i.test(url)) return { kind: 'data', url }
  if (/^data:/i.test(url)) return { kind: 'unknown-scheme', url, scheme: 'data' }

  // 协议相对地址 //host/path
  if (url.startsWith('//')) return { kind: 'protocol-relative', url }

  // 显式本地文件协议
  if (/^file:/i.test(url)) return { kind: 'local', url, reason: 'file' }

  // Windows 路径：C:\... 或 C:/...、\\UNC\path
  if (/^[a-zA-Z]:[\\/]/.test(url)) return { kind: 'local', url, reason: 'windows' }
  if (url.startsWith('\\\\')) return { kind: 'local', url, reason: 'unc' }

  // 类 Unix 用户目录
  if (url.startsWith('~/')) return { kind: 'local', url, reason: 'home' }

  // 带 scheme 的绝对地址
  const schemeMatch = url.match(/^([a-zA-Z][a-zA-Z\d+.-]*):/)
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()
    if (scheme === 'http' || scheme === 'https') return { kind: 'remote', url, scheme }
    // 浏览器中可安全尝试的协议之外，一律视为未知协议（不发起请求）
    return { kind: 'unknown-scheme', url, scheme }
  }

  // 其余：站点绝对路径 / 相对路径 / 裸文件名 —— 用相对地址尝试加载，
  // 不再把它们误判为「本地路径」。
  return { kind: 'relative', url }
}

/**
 * 分类结果是否允许发起网络加载。
 */
export function canLoad(kind) {
  return kind === 'remote' || kind === 'protocol-relative' ||
    kind === 'data' || kind === 'relative'
}

/**
 * 把分类映射为加载状态机的初始 status。
 */
export function initialStatus(rawUrl) {
  const { kind, scheme } = classifyUrl(rawUrl)
  if (kind === 'empty') return { status: 'empty', kind }
  if (kind === 'local') return { status: 'local', kind }
  if (kind === 'unknown-scheme') return { status: 'unsupported', kind, scheme }
  return { status: 'loading', kind }
}

/**
 * 转义替代文本：替换 ] 与反斜杠；并把换行压成空格（图片是行内语法）。
 */
export function escapeAlt(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/]/g, '\\]')
    .replace(/\r?\n/g, ' ')
    .trim()
}

/**
 * 生成写回文档的图片目标地址。含空格 / 圆括号时用尖括号包裹，
 * 保证 round-trip 后仍能被解析器识别（不改正文语义）。
 */
export function formatDestination(rawUrl) {
  const url = String(rawUrl || '').trim()
  if (!url) return ''
  if (/^data:image\//i.test(url)) return url
  if (/[\s()"]/.test(url) || /^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('\\\\')) {
    return `<${url}>`
  }
  return url
}

/**
 * 用 Image 探测一张图片是否可加载。
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeout=10000] 网络超时（ms）
 * @param {AbortSignal} [opts.signal] 中断信号（修改地址 / 对话框关闭时使用）
 * @returns {Promise<{url:string}>} 成功 resolve；失败 reject Error(code)
 *   code: 'error' | 'timeout' | 'aborted'
 */
export function probeImage(url, { timeout = 10000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(Object.assign(new Error('aborted'), { code: 'aborted' }))
      return
    }

    const img = new Image()
    let settled = false
    let timer = null

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      img.onload = null
      img.onerror = null
    }

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }

    const onAbort = () => {
      img.src = ''
      finish(reject, Object.assign(new Error('aborted'), { code: 'aborted' }))
    }

    timer = setTimeout(() => {
      img.src = ''
      finish(reject, Object.assign(new Error('timeout'), { code: 'timeout' }))
    }, timeout)

    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    img.referrerPolicy = 'no-referrer'
    img.onload = () => finish(resolve, { url })
    img.onerror = () => finish(reject, Object.assign(new Error('error'), { code: 'error' }))
    img.src = url
  })
}
