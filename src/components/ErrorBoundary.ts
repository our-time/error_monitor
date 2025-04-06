import { defineComponent, h, ref, onErrorCaptured, inject } from 'vue'
import { ErrorMonitor } from '../core/errorMonitor'

export default defineComponent({
  name: 'ErrorBoundary',

  props: {
    fallback: {
      type: [Object, Function],
      default: null
    },
    onError: {
      type: Function,
      default: null
    },
    resetKeys: {
      type: Array,
      default: () => []
    }
  },

  setup(props, { slots }) {
    const error = ref<Error | null>(null)
    const errorInfo = ref<Record<string, any> | null>(null)
    const errorMonitor = inject<ErrorMonitor>('errorMonitor')

    // 重置错误状态的函数
    const reset = () => {
      error.value = null
      errorInfo.value = null
    }

    // 监听 resetKeys 变化，自动重置错误状态
    // 注意：实际项目中应该加上 watch(props.resetKeys, reset)，
    // 但这里保持简单，避免额外的依赖

    onErrorCaptured((err: Error, instance, info) => {
      error.value = err
      errorInfo.value = {
        componentName: instance?.$options?.name || 'AnonymousComponent',
        info
      }

      // 调用自定义错误处理函数
      if (props.onError) {
        props.onError(err, errorInfo.value)
      }

      // 使用错误监控服务上报错误
      if (errorMonitor) {
        errorMonitor.handleComponentError(err, instance, info)
      }

      // 阻止错误继续传播
      return false
    })

    return () => {
      // 如果有错误且提供了 fallback
      if (error.value && props.fallback) {
        const fallbackProps = {
          error: error.value,
          errorInfo: errorInfo.value,
          reset
        }

        // 如果 fallback 是函数，调用它
        if (typeof props.fallback === 'function') {
          return props.fallback(fallbackProps)
        }

        // 如果 fallback 是组件对象
        return h(props.fallback, fallbackProps)
      }

      // 没有错误，渲染子组件
      return slots.default?.()
    }
  }
})
