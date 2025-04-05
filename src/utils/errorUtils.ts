interface ErrorInfo {
  message: string
  name: string
  stack: string
}

export function getErrorInfo(error: Error | any): ErrorInfo {
  if (!error) {
    return {
      message: 'Unknown error',
      name: 'Error',
      stack: ''
    }
  }

  // 如果是 Error 对象
  if (error instanceof Error) {
    return {
      message: error.message || 'Unknown error',
      name: error.name || 'Error',
      stack: error.stack || ''
    }
  }

  // 如果是字符串
  if (typeof error === 'string') {
    return {
      message: error,
      name: 'Error',
      stack: ''
    }
  }

  // 如果是对象
  if (typeof error === 'object') {
    return {
      message: error.message || String(error),
      name: error.name || 'Error',
      stack: error.stack || ''
    }
  }

  // 其他类型
  return {
    message: String(error),
    name: 'Error',
    stack: ''
  }
}

export function generateErrorId(errorInfo: ErrorInfo): string {
  // 从错误信息中提取关键部分生成唯一 ID
  const { name, message, stack } = errorInfo

  // 从堆栈中提取第一行作为错误位置
  const stackLine = stack.split('\n')[1] || ''
  const locationMatch = stackLine.match(/at\s+(.+):(\d+):(\d+)/)
  const errorLocation = locationMatch ? `${locationMatch[1]}:${locationMatch[2]}` : ''

  // 组合错误 ID
  const idParts = [name, message.substring(0, 100), errorLocation].filter(Boolean).join('|')

  // 使用简单的哈希函数
  return hashString(idParts)
}

function hashString(str: string): string {
  let hash = 0

  if (str.length === 0) {
    return hash.toString(36)
  }

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }

  // 转换为更短的字符串
  return Math.abs(hash).toString(36)
}
