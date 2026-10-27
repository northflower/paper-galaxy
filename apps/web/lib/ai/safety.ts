/** 输入侧兜底：长度限制 + 明显的越权指令拦截。输出侧依赖引用约束与前端依据强度提示。 */

const INJECTION_PATTERNS = [
  /ignore (all|any|previous) (instructions|prompts)/i,
  /忽略(之前|以上|所有)的?(指令|提示|规则)/,
  /reveal (your|the) system prompt/i,
  /输出你的(系统)?提示词/,
];

export function checkUserInput(text: string, maxLength = 2000): string | null {
  if (!text.trim()) return "问题不能为空";
  if (text.length > maxLength) return `输入过长（最多 ${maxLength} 字）`;
  if (INJECTION_PATTERNS.some((p) => p.test(text))) return "该请求与论文研读无关，已被安全策略拦截";
  return null;
}

/** 截断上下文文本，控制单次请求的 token 开销 */
export function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
