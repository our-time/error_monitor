import { ReportService } from '../services/reportService'
import { StateConfig } from '../types/config'

export class StateMonitor {
  private reportService: ReportService
  private config: StateConfig
  private stateSnapshotInterval: number | null = null

  constructor(reportService: ReportService, config: StateConfig) {
    this.reportService = reportService
    this.config = config
    this.init()
  }

  private init(): void {
    // 监控 Vuex
    if (this.config.vuex && this.config.captureState) {
      this.setupVuexMonitoring()
    }

    // 监控 Pinia
    if (this.config.pinia && this.config.captureState) {
      this.setupPiniaMonitoring()
    }

    // 定期捕获状态快照
    if (this.config.stateSnapshotInterval > 0) {
      this.startStateSnapshotCapture()
    }
  }

  private setupVuexMonitoring(): void {
    const store = this.config.vuex

    if (this.config.captureActions) {
      store.subscribeAction({
        before: (action: any) => {
          this.reportStateChange('vuex_action_before', action.type, action.payload)
        },
        after: (action: any) => {
          this.reportStateChange('vuex_action_after', action.type, action.payload)
        },
        error: (action: any, error: Error) => {
          this.reportStateError('vuex_action_error', action.type, error)
        }
      })
    }

    if (this.config.captureMutations) {
      store.subscribe((mutation: any) => {
        this.reportStateChange('vuex_mutation', mutation.type, mutation.payload)
      })
    }
  }

  private setupPiniaMonitoring(): void {
    const pinia = this.config.pinia

    // 监听所有 store 的变化
    pinia.use(({ store }: any) => {
      // 监听 actions
      if (this.config.captureActions) {
        store.$onAction(({ name, args, after, onError }: any) => {
          this.reportStateChange('pinia_action_before', `${store.$id}/${name}`, args[0])

          after((result: any) => {
            this.reportStateChange('pinia_action_after', `${store.$id}/${name}`, result)
          })

          onError((error: Error) => {
            this.reportStateError('pinia_action_error', `${store.$id}/${name}`, error)
          })
        })
      }

      // 监听 state 变化
      if (this.config.captureMutations) {
        store.$subscribe((mutation: any) => {
          this.reportStateChange('pinia_state_change', store.$id, {
            type: mutation.type,
            events: mutation.events
          })
        })
      }
    })
  }

  private startStateSnapshotCapture(): void {
    this.stateSnapshotInterval = window.setInterval(() => {
      let stateSnapshot: any = {}

      // 捕获 Vuex 状态
      if (this.config.vuex) {
        stateSnapshot.vuex = this.sanitizeState(this.config.vuex.state)
      }

      // 捕获 Pinia 状态
      if (this.config.pinia) {
        stateSnapshot.pinia = {}
        const stores = Object.keys(this.config.pinia.state.value)

        stores.forEach(storeId => {
          stateSnapshot.pinia[storeId] = this.sanitizeState(this.config.pinia.state.value[storeId])
        })
      }

      this.reportService.reportPerformance({
        type: 'state_snapshot',
        state: stateSnapshot,
        timestamp: new Date().toISOString()
      })
    }, this.config.stateSnapshotInterval)
  }

  private reportStateChange(type: string, action: string, payload: any): void {
    this.reportService.reportPerformance({
      type,
      action,
      payload: this.sanitizePayload(payload),
      timestamp: new Date().toISOString()
    })
  }

  private reportStateError(type: string, action: string, error: Error): void {
    this.reportService.reportError({
      type,
      action,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    })
  }

  private sanitizeState(state: any): any {
    if (!state) return null

    try {
      const serialized = JSON.stringify(state)

      // 检查状态大小是否超过限制
      if (serialized.length > this.config.maxStateSize) {
        return {
          _truncated: true,
          _size: serialized.length,
          _keys: Object.keys(state)
        }
      }

      return JSON.parse(serialized)
    } catch (e) {
      // 如果状态无法序列化，返回键列表
      return {
        _error: 'Cannot serialize state',
        _keys: Object.keys(state)
      }
    }
  }

  private sanitizePayload(payload: any): any {
    if (!payload) return null

    try {
      return JSON.parse(JSON.stringify(payload))
    } catch (e) {
      return {
        _error: 'Cannot serialize payload',
        _type: typeof payload
      }
    }
  }

  public destroy(): void {
    if (this.stateSnapshotInterval) {
      clearInterval(this.stateSnapshotInterval)
    }
  }
}
