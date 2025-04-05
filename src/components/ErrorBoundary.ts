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
    }
  },

  setup(props, { slots }) {
    const error = ref<Error | null>(null)
    const errorInfo = ref<Record<string, any> | null>(null)
    const errorMonitor = inject<ErrorMonitor>('errorMonitor')

    onErrorCaptured((err: Error, instance, info) => {
      error.value = err
      errorInfo.value = {
        componentName: instance?.$options.name || 'AnonymousComponent',
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
        // 如果 fallback 是函数，调用它
        if (typeof props.fallback === 'function') {
          return props.fallback({
            error: error.value,
            errorInfo: errorInfo.value,
            reset: () => {
              error.value = null
              errorInfo.value = null
            }
          })
        }

        // 如果 fallback 是组件对象
        return h(props.fallback, {
          error: error.value,
          errorInfo: errorInfo.value,
          reset: () => {
            error.value = null
            errorInfo.value = null
          }
        })
      }

      // 没有错误，渲染子组件
      return slots.default?.()
    }
  }
})
