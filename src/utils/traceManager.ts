import { v4 as uuidv4 } from 'uuid'

export class TraceManager {
  private traceId: string = ''
  private sessionId: string = ''
  private pageLoadId: string = ''

  constructor() {
    this.init()
  }

  private init(): void {
    // 生成会话 ID，在整个会话期间保持不变
    this.sessionId = this.getOrCreateSessionId()

    // 生成页面加载 ID，每次页面加载时更新
    this.pageLoadId = this.generateTraceId()

    // 初始化 traceId 为页面加载 ID
    this.traceId = this.pageLoadId

    // 页面卸载时保存会话信息
    window.addEventListener('beforeunload', () => {
      this.saveSessionData()
    })
  }

  private getOrCreateSessionId(): string {
    // 尝试从 sessionStorage 获取会话 ID
    let sessionId = sessionStorage.getItem('errorMonitor_sessionId')

    // 如果不存在，创建新的会话 ID
    if (!sessionId) {
      sessionId = uuidv4()
      sessionStorage.setItem('errorMonitor_sessionId', sessionId)
    }

    return sessionId
  }

  private saveSessionData(): void {
    // 保存当前会话数据
    sessionStorage.setItem('errorMonitor_sessionId', this.sessionId)
    sessionStorage.setItem('errorMonitor_lastActive', Date.now().toString())
  }

  public generateTraceId(): string {
    return uuidv4()
  }

  public getTraceId(): string {
    return this.traceId
  }

  public setTraceId(traceId: string): void {
    this.traceId = traceId
  }

  public getSessionId(): string {
    return this.sessionId
  }

  public getPageLoadId(): string {
    return this.pageLoadId
  }

  public getTraceInfo(): Record<string, string> {
    return {
      traceId: this.traceId,
      sessionId: this.sessionId,
      pageLoadId: this.pageLoadId
    }
  }
}
