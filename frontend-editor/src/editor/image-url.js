/**
 * 图片地址分类与校验工具。
 *
 * 所有函数均为纯函数：只读判定、不修改编辑器状态。
 * 任何判定结果（包括误判）都不会改动正文——正文始终是原始 Markdown，
 * 判定只影响预览层（ImageWidget）的展示状态。
 */

// 明确的本地文件系统路径（浏览器安全策略禁止网页直接访问）
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/ // C:\ 或 C:/
const UNC_PATH_RE = /^\\\\/ // \\server\share
const HOME_PATH_RE = /^~[\\/]/ // ~/...
const FILE_PROTOCOL_RE = /^file:\/\//i

// 浏览器可直接加载的地址
const NETWORK_RE = /^https?:\/\//i
const PROTOCOL_RELATIVE_RE = /^\/\//
const DATA_IMAGE_RE = /^data:image\//i
const BLOB_RE = /^blob:/i

// 任意 scheme:... 形式（用于识别未知协议）
const ANY_PROTOCOL_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/

/**
 * @typedef {'empty'|'network'|'embed'|'local'|'relative'|'unknown-protocol'} ImageUrlKind
 *
 * - empty:            未填写地址
 * - network:          http(s):// 或协议相对 //host/...，可直接加载
 * - embed:            data:image/... 或 blob:...，可直接加载
 * - local:            本地文件系统路径，浏览器禁止访问，不尝试加载
 * - relative:         ./ ../ / 或裸文件名，按当前站点解析后尝试加载
 * - unknown-protocol: 无法识别的协议（ftp:、javascript: 等），不尝试加载
 */

/**
 * 对图片地址进行分类。
 * @param {string} rawUrl
 * @returns {{ kind: ImageUrlKind, protocol?: string }}
 */
export function classifyImageUrl(rawUrl) {
  const url = (rawUrl ?? '').trim()
  if (!url) return { kind: 'empty' }

  if (
    FILE_PROTOCOL_RE.test(url) ||
    WINDOWS_DRIVE_RE.test(url) ||
    UNC_PATH_RE.test(url) ||
    HOME_PATH_RE.test(url)
  ) {
    return { kind: 'local' }
  }

  if (NETWORK_RE.test(url)) {
    return { kind: 'network', protocol: url.slice(0, url.indexOf(':')).toLowerCase() }
  }
  if (PROTOCOL_RELATIVE_RE.test(url)) return { kind: 'network', protocol: 'protocol-relative' }
  if (DATA_IMAGE_RE.test(url)) return { kind: 'embed', protocol: 'data' }
  if (BLOB_RE.test(url)) return { kind: 'embed', protocol: 'blob' }

  const m = url.match(ANY_PROTOCOL_RE)
  if (m) return { kind: 'unknown-protocol', protocol: m[1].toLowerCase() }

  // ./、../、/、裸文件名：按当前站点 origin 解析的相对地址，可以尝试加载。
  // 加载失败会进入可恢复的错误态，不会误判为本地路径直接拒绝。
  return { kind: 'relative' }
}

/**
 * 该分类是否允许尝试加载。
 * @param {ImageUrlKind} kind
 */
export function canAttemptLoad(kind) {
  return kind === 'network' || kind === 'embed' || kind === 'relative'
}

/**
 * 校验图片地址（用于插入对话框与预览提示）。
 * level 为 'error' 时禁止提交（会生成破碎语法或必然无效），
 * 'warning' 时允许提交但给出提示（预览层会展示对应的可恢复状态）。
 *
 * @param {string} rawUrl
 * @returns {{ ok: boolean, level: 'error'|'warning'|'none', message: string }}
 */
export function validateImageUrl(rawUrl) {
  const url = (rawUrl ?? '').trim()
  if (!url) {
    return { ok: false, level: 'error', message: '请输入图片地址' }
  }
  if (/\s/.test(url)) {
    return { ok: false, level: 'error', message: '地址不能包含空格，如有空格请先进行 URL 编码（%20）' }
  }
  if (url.includes('(') || url.includes(')')) {
    return { ok: false, level: 'error', message: '地址不能包含圆括号，可先进行 URL 编码（%28 / %29）' }
  }

  const { kind, protocol } = classifyImageUrl(url)
  if (kind === 'local') {
    return { ok: true, level: 'warning', message: '这是本地文件路径，浏览器安全策略禁止网页访问，预览将无法显示图片' }
  }
  if (kind === 'unknown-protocol') {
    return { ok: true, level: 'warning', message: `未知协议 ${protocol}:，浏览器无法加载该地址` }
  }
  if (kind === 'relative') {
    return { ok: true, level: 'none', message: '相对地址将按当前站点域名解析' }
  }
  return { ok: true, level: 'none', message: '' }
}

/**
 * 校验替代文本。alt 中的方括号会破坏 ![alt](url) 语法结构，禁止提交。
 * @param {string} alt
 * @returns {{ ok: boolean, level: 'error'|'warning'|'none', message: string }}
 */
export function validateAltText(alt) {
  if (/[[\]]/.test(alt ?? '')) {
    return { ok: false, level: 'error', message: '替代文本不能包含 [ 或 ]，否则会破坏图片语法' }
  }
  return { ok: true, level: 'none', message: '' }
}
