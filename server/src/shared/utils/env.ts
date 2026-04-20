/**
 * 环境变量读取 helper
 *
 * 提供类型安全的环境变量读取器，启动时统一校验。
 * 缺失必填项或格式错误时立即 throw，实现 fail-fast，
 * 避免服务先启动成功、第一次访问外部服务时才失败。
 */

/**
 * 读取必填字符串环境变量
 *
 * 变量不存在或为空字符串时直接抛错。
 *
 * @param key - 环境变量名
 * @returns 环境变量值
 */
export function requireString(key: string): string {
  const value = process.env[key];

  if (value === undefined || value === '') {
    throw new Error(`缺少必填环境变量: ${key}`);
  }

  return value;
}

/**
 * 读取可选字符串环境变量
 *
 * 变量不存在时返回 defaultValue。
 *
 * @param key - 环境变量名
 * @param defaultValue - 缺失时的默认值，默认为空字符串
 * @returns 环境变量值或默认值
 */
export function optionalString(key: string, defaultValue = ''): string {
  const value = process.env[key];

  if (value === undefined || value === '') {
    return defaultValue;
  }

  return value;
}

/**
 * 读取必填整数环境变量
 *
 * 变量不存在、为空、或无法解析为整数时直接抛错。
 * 使用 parseInt 而非 Number()，避免 `Number('') === 0` 的静默降级。
 *
 * @param key - 环境变量名
 * @param defaultValue - 缺失时的默认值（传入则变为可选）
 * @returns 解析后的整数值
 */
export function requireInt(key: string, defaultValue?: number): number {
  const raw = process.env[key];

  // 未设置 → 看有没有默认值
  if (raw === undefined || raw === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`缺少必填环境变量: ${key}`);
  }

  const parsed = parseInt(raw, 10);

  if (isNaN(parsed)) {
    throw new Error(`环境变量 ${key} 必须为整数，当前值: "${raw}"`);
  }

  return parsed;
}

/**
 * 读取必填浮点数环境变量
 *
 * 变量不存在、为空、或无法解析为有限浮点数时直接抛错。
 *
 * @param key - 环境变量名
 * @param defaultValue - 缺失时的默认值（传入则变为可选）
 * @returns 解析后的浮点数值
 */
export function requireFloat(key: string, defaultValue?: number): number {
  const raw = process.env[key];

  // 未设置 → 看有没有默认值
  if (raw === undefined || raw === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`缺少必填环境变量: ${key}`);
  }

  const parsed = parseFloat(raw);

  if (!Number.isFinite(parsed)) {
    throw new Error(`环境变量 ${key} 必须为数字，当前值: "${raw}"`);
  }

  return parsed;
}

/**
 * 读取枚举类型的环境变量
 *
 * 变量值不在合法枚举范围内时直接抛错。
 *
 * @param key - 环境变量名
 * @param validValues - 合法值列表
 * @param defaultValue - 缺失时的默认值（传入则变为可选）
 * @returns 校验通过的枚举值
 */
export function requireEnum<T extends string | number>(
  key: string,
  validValues: readonly T[],
  defaultValue?: T
): T {
  const raw = process.env[key];

  // 未设置 → 看有没有默认值
  if (raw === undefined || raw === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`缺少必填环境变量: ${key}`);
  }

  // 尝试数字解析（支持数字枚举）
  const asNumber = Number(raw);
  const value = (isNaN(asNumber) ? raw : asNumber) as T;

  if (!validValues.includes(value)) {
    throw new Error(`环境变量 ${key} 的值 "${raw}" 不合法，合法值为: ${validValues.join(', ')}`);
  }

  return value;
}
