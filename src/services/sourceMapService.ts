import { SourceMapConfig } from '../types/config'
import * as StackTrace from 'stacktrace-js'

export class SourceMapService {
  private config: SourceMapConfig

  constructor(config: SourceMapConfig) {
    this.config = config
  }

  public isEnabled(): boolean {
    return this.config.enabled
  }

  public async mapStackTrace(stack: string): Promise<string> {
    if (!this.isEnabled()) {
      return stack
    }

    try {
      // 使用 stacktrace-js 解析错误堆栈
      const stackFrames = await StackTrace.fromError(new Error(stack))

      // 将堆栈帧转换为可读字符串
      const mappedStack = stackFrames
        .map(frame => {
          let source = frame.fileName || ''

          // 移除项目根路径前缀
          if (this.config.stripProjectRoot && source.startsWith(this.config.stripProjectRoot)) {
            source = source.substring(this.config.stripProjectRoot.length)
          }

          return `    at ${frame.functionName || '(anonymous)'} (${source}:${frame.lineNumber}:${frame.columnNumber})`
        })
        .join('\n')

      return mappedStack
    } catch (error) {
      console.error('Error mapping stack trace:', error)
      return stack // 如果映射失败，返回原始堆栈
    }
  }

  public async uploadSourceMap(sourceMapFile: File, sourceFile: string): Promise<boolean> {
    if (!this.isEnabled() || !this.config.uploadSourceMap || !this.config.sourceMapEndpoint) {
      return false
    }

    try {
      const formData = new FormData()
      formData.append('sourceMap', sourceMapFile)
      formData.append('sourceFile', sourceFile)

      if (this.config.includeSourceContent) {
        // 读取源文件内容
        const sourceContent = await this.readFileAsText(sourceMapFile)
        formData.append('sourceContent', sourceContent)
      }

      const response = await fetch(this.config.sourceMapEndpoint, {
        method: 'POST',
        body: formData
      })

      return response.ok
    } catch (error) {
      console.error('Error uploading source map:', error)
      return false
    }
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsText(file)
    })
  }
}
