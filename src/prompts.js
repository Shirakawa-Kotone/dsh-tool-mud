/**
 * The handful of prompts the plugin recognizes.
 *
 * Two kinds, deliberately asymmetric:
 *  - LOGIN_PROMPTS are answered automatically, and only during `login`. This is
 *    the whole of the automation: encoding menu, id, password.
 *  - FULLME_PATTERNS are only *detected*, never answered. Solving the fullme
 *    captcha needs a human (or a vision model, which is out of scope here), so
 *    the session just raises a flag and says so.
 */

/** Login prompts, in the order the server asks them. */
export const LOGIN_PROMPTS = [
  {
    key: 'encoding',
    re: /Input 1 for GBK, 2 for UTF8, 3 for BIG5/,
    value: (_creds, opts) => opts.encodingMenu,
  },
  {
    key: 'id',
    re: /您的英文名字（要注册新人物请输入new。）：/,
    value: (creds) => creds.id,
  },
  {
    key: 'id',
    re: /您的英文名字：/,
    value: (creds) => creds.id,
  },
  {
    key: 'password',
    re: /请输入您的密码：|请输入密码：|密码：/,
    value: (creds) => creds.password,
  },
]

/**
 * Find the next login prompt to answer.
 *
 * Scans from `from` and returns the *earliest* match, not the first pattern that
 * matches, so an id prompt that appears before a password prompt is answered in
 * the right order.
 *
 * @param {string} buffer
 * @param {number} from - offset already scanned
 * @param {{id?: string, password?: string}} creds
 * @param {{encodingMenu: string}} opts
 * @returns {{at: number, end: number, key: string, value: string} | null}
 */
export function findLoginPrompt(buffer, from, creds, opts) {
  let best = null
  for (const prompt of LOGIN_PROMPTS) {
    const match = prompt.re.exec(buffer.slice(from))
    if (!match) continue
    const at = from + match.index
    if (best !== null && at >= best.at) continue
    best = {
      at,
      end: at + match[0].length,
      key: prompt.key,
      value: String(prompt.value(creds, opts) ?? ''),
    }
  }
  return best
}

/**
 * Texts that mean "a fullme captcha is waiting for a human".
 *
 * Observed on the live server:
 *   http://fullme.pkuxkx.net/robot.php?filename=179397480154412
 *   还是用这个命令，指令格式: fullme 验证码
 * The 活跃度偏低 reminder is NOT included: it is a nudge, it does not block play.
 */
export const FULLME_PATTERNS = [
  /fullme\.pkuxkx\.net\/robot\.php\?filename=\d+/i,
  /指令格式[:：]\s*fullme\s*验证码/,
  /请(?:输入|提交)\s*fullme/i,
]

/** @param {string} text @returns {boolean} */
export function detectFullme(text) {
  return FULLME_PATTERNS.some((pattern) => pattern.test(text))
}
