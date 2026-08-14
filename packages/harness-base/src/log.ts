/**
 * 轻量日志级别（设置面第二批）。
 * cordis 内置 logger 无公开级别设置，此处提供纯函数过滤 + 统一前缀。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

/** 是否应输出 actual 级别（minLevel 为当前配置级别） */
export function shouldLog(actual: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_ORDER[actual] >= LEVEL_ORDER[minLevel]
}
