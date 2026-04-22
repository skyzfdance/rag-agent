/**
 * 判断值是否为非 null 的 plain object
 *
 * @param value - 待检测的值
 * @returns 是否为 object 类型且非 null
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
