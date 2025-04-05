'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var require$$0 = require('stackframe');
var require$$1 = require('stack-generator');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var require$$0__default = /*#__PURE__*/_interopDefaultLegacy(require$$0);
var require$$1__default = /*#__PURE__*/_interopDefaultLegacy(require$$1);

function getErrorInfo(error) {
    if (!error) {
        return {
            message: 'Unknown error',
            name: 'Error',
            stack: ''
        };
    }
    // 如果是 Error 对象
    if (error instanceof Error) {
        return {
            message: error.message || 'Unknown error',
            name: error.name || 'Error',
            stack: error.stack || ''
        };
    }
    // 如果是字符串
    if (typeof error === 'string') {
        return {
            message: error,
            name: 'Error',
            stack: ''
        };
    }
    // 如果是对象
    if (typeof error === 'object') {
        return {
            message: error.message || String(error),
            name: error.name || 'Error',
            stack: error.stack || ''
        };
    }
    // 其他类型
    return {
        message: String(error),
        name: 'Error',
        stack: ''
    };
}
function generateErrorId(errorInfo) {
    // 从错误信息中提取关键部分生成唯一 ID
    const { name, message, stack } = errorInfo;
    // 从堆栈中提取第一行作为错误位置
    const stackLine = stack.split('\n')[1] || '';
    const locationMatch = stackLine.match(/at\s+(.+):(\d+):(\d+)/);
    const errorLocation = locationMatch ? `${locationMatch[1]}:${locationMatch[2]}` : '';
    // 组合错误 ID
    const idParts = [name, message.substring(0, 100), errorLocation].filter(Boolean).join('|');
    // 使用简单的哈希函数
    return hashString(idParts);
}
function hashString(str) {
    let hash = 0;
    if (str.length === 0) {
        return hash.toString(36);
    }
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    // 转换为更短的字符串
    return Math.abs(hash).toString(36);
}

class ErrorMonitor {
    constructor(app, reportService, sourceMapService, config) {
        this.errorCount = new Map();
        this.app = app;
        this.reportService = reportService;
        this.sourceMapService = sourceMapService;
        this.config = config;
        // 每分钟重置错误计数
        this.errorCountResetInterval = window.setInterval(() => {
            this.errorCount.clear();
        }, 60000);
        this.app.config.globalProperties.$errorMonitor = this;
        this.init();
    }
    init() {
        if (this.config.captureGlobalErrors) {
            this.setupGlobalErrorHandler();
        }
        if (this.config.capturePromiseErrors) {
            this.setupPromiseErrorHandler();
        }
        if (this.config.captureAjaxErrors) {
            this.setupAjaxErrorHandler();
        }
        if (this.config.captureResourceErrors) {
            this.setupResourceErrorHandler();
        }
    }
    setupGlobalErrorHandler() {
        window.addEventListener('error', event => {
            // 忽略资源加载错误，这些由 setupResourceErrorHandler 处理
            if (event.error && !this.isResourceError(event)) {
                this.handleJsError(event.error, {
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno,
                    message: event.message
                });
            }
            return true; // 不阻止默认处理
        }, true);
    }
    setupPromiseErrorHandler() {
        window.addEventListener('unhandledrejection', event => {
            const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
            this.handleJsError(error, {
                type: 'unhandledrejection',
                message: String(event.reason)
            });
        });
    }
    setupAjaxErrorHandler() {
        const originalXhrOpen = XMLHttpRequest.prototype.open;
        const originalXhrSend = XMLHttpRequest.prototype.send;
        const originalFetch = window.fetch;
        const self = this;
        // 拦截 XMLHttpRequest
        XMLHttpRequest.prototype.open = function (method, url, async = true, username, password) {
            this._url = url;
            this._method = method;
            return originalXhrOpen.apply(this, [method, url, async, username, password]);
        };
        XMLHttpRequest.prototype.send = function (...args) {
            this.addEventListener('error', function () {
                self.handleNetworkError(new Error(`XHR Error: ${this._url}`), {
                    url: this._url,
                    method: this._method,
                    status: this.status,
                    statusText: this.statusText
                });
            });
            this.addEventListener('timeout', function () {
                self.handleNetworkError(new Error(`XHR Timeout: ${this._url}`), {
                    url: this._url,
                    method: this._method,
                    timeout: this.timeout
                });
            });
            return originalXhrSend.apply(this, args);
        };
        // 拦截 Fetch
        window.fetch = function (...args) {
            var _a;
            const url = typeof args[0] === 'string' ? args[0] : args[0].url;
            const method = ((_a = args[1]) === null || _a === void 0 ? void 0 : _a.method) || 'GET';
            return originalFetch.apply(window, args).catch(error => {
                self.handleNetworkError(error, {
                    url,
                    method
                });
                throw error;
            });
        };
    }
    setupResourceErrorHandler() {
        window.addEventListener('error', event => {
            if (this.isResourceError(event)) {
                const target = event.target;
                const tagName = target.tagName.toLowerCase();
                this.handleResourceError(new Error(`Failed to load ${tagName}`), {
                    tagName,
                    src: target.src || target.href,
                    type: target.getAttribute('type'),
                    id: target.id,
                    className: target.className
                });
            }
            return true;
        }, true);
    }
    isResourceError(event) {
        const target = event.target;
        return (target instanceof HTMLElement &&
            (target.tagName === 'IMG' ||
                target.tagName === 'SCRIPT' ||
                target.tagName === 'LINK' ||
                target.tagName === 'AUDIO' ||
                target.tagName === 'VIDEO'));
    }
    handleJsError(error, context = {}) {
        if (this.shouldIgnoreError(error)) {
            return;
        }
        if (this.isRateLimited(error)) {
            return;
        }
        this.processAndReportError(error, {
            type: 'js_error',
            ...context
        });
    }
    handleComponentError(error, instance, info) {
        if (this.shouldIgnoreError(error)) {
            return;
        }
        if (this.isRateLimited(error)) {
            return;
        }
        const componentName = instance ? instance.$options.name || 'AnonymousComponent' : 'Unknown';
        this.processAndReportError(error, {
            type: 'vue_error',
            componentName,
            lifecycleHook: info,
            componentData: instance ? this.sanitizeComponentData(instance.$data) : null
        });
    }
    handleNetworkError(error, context = {}) {
        if (this.shouldIgnoreError(error)) {
            return;
        }
        if (this.isRateLimited(error)) {
            return;
        }
        this.processAndReportError(error, {
            type: 'network_error',
            ...context
        });
    }
    handleResourceError(error, context = {}) {
        if (this.shouldIgnoreError(error)) {
            return;
        }
        if (this.isRateLimited(error)) {
            return;
        }
        this.processAndReportError(error, {
            type: 'resource_error',
            ...context
        });
    }
    async processAndReportError(error, context = {}) {
        const errorInfo = getErrorInfo(error);
        const errorId = generateErrorId(errorInfo);
        // 使用 SourceMap 服务解析错误堆栈
        let stackFrames = errorInfo.stack;
        if (this.sourceMapService.isEnabled()) {
            try {
                stackFrames = await this.sourceMapService.mapStackTrace(errorInfo.stack);
            }
            catch (e) {
                console.error('Failed to map stack trace:', e);
            }
        }
        const reportData = {
            errorId,
            message: errorInfo.message,
            stack: stackFrames,
            type: context.type || 'unknown',
            url: window.location.href,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            context
        };
        this.reportService.reportError(reportData);
    }
    shouldIgnoreError(error) {
        if (!error)
            return true;
        const message = error.message || '';
        return (this.config.ignoreErrors || []).some(pattern => {
            if (pattern instanceof RegExp) {
                return pattern.test(message);
            }
            return message.includes(pattern);
        });
    }
    isRateLimited(error) {
        const errorId = generateErrorId(getErrorInfo(error));
        const count = (this.errorCount.get(errorId) || 0) + 1;
        this.errorCount.set(errorId, count);
        return count > this.config.maxErrorsPerMinute;
    }
    sanitizeComponentData(data) {
        if (!data)
            return null;
        try {
            // 简单的深拷贝，移除可能的循环引用
            return JSON.parse(JSON.stringify(data));
        }
        catch (e) {
            // 如果数据无法序列化，返回简化版本
            return Object.keys(data).reduce((acc, key) => {
                const value = data[key];
                acc[key] = typeof value === 'object' ? '[Complex Object]' : value;
                return acc;
            }, {});
        }
    }
    destroy() {
        clearInterval(this.errorCountResetInterval);
        // 清理其他可能的事件监听器
    }
}

class PerformanceMonitor {
    constructor(reportService, config) {
        this.metricsInterval = null;
        this.frameRateInterval = null;
        this.longTaskObserver = null;
        this.resourceObserver = null;
        this.reportService = reportService;
        this.config = config;
        this.init();
    }
    init() {
        if (this.config.capturePageLoad) {
            this.capturePageLoadMetrics();
        }
        if (this.config.capturePaint) {
            this.capturePaintMetrics();
        }
        if (this.config.captureMemory) {
            this.startMemoryMonitoring();
        }
        if (this.config.captureFrameRate) {
            this.startFrameRateMonitoring();
        }
        if (this.config.resourceTiming) {
            this.observeResourceTiming();
        }
        // 监控长任务
        this.observeLongTasks();
        // Web Vitals 指标
        this.captureWebVitals();
    }
    capturePageLoadMetrics() {
        window.addEventListener('load', () => {
            setTimeout(() => {
                const perfData = window.performance.timing;
                const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
                const dnsTime = perfData.domainLookupEnd - perfData.domainLookupStart;
                const tcpTime = perfData.connectEnd - perfData.connectStart;
                const ttfb = perfData.responseStart - perfData.requestStart;
                const domReadyTime = perfData.domContentLoadedEventEnd - perfData.navigationStart;
                const domInteractive = perfData.domInteractive - perfData.navigationStart;
                this.reportService.reportPerformance({
                    type: 'page_load',
                    metrics: {
                        pageLoadTime,
                        dnsTime,
                        tcpTime,
                        ttfb,
                        domReadyTime,
                        domInteractive
                    },
                    url: window.location.href,
                    timestamp: new Date().toISOString()
                });
            }, 0);
        });
    }
    capturePaintMetrics() {
        const observer = new PerformanceObserver(list => {
            const entries = list.getEntries();
            entries.forEach(entry => {
                if (entry.name === 'first-paint' || entry.name === 'first-contentful-paint') {
                    this.reportService.reportPerformance({
                        type: 'paint',
                        metrics: {
                            name: entry.name,
                            startTime: entry.startTime
                        },
                        url: window.location.href,
                        timestamp: new Date().toISOString()
                    });
                }
            });
        });
        observer.observe({ entryTypes: ['paint'] });
    }
    startMemoryMonitoring() {
        if (performance && performance.memory) {
            this.metricsInterval = window.setInterval(() => {
                const memoryInfo = performance.memory;
                this.reportService.reportPerformance({
                    type: 'memory',
                    metrics: {
                        jsHeapSizeLimit: memoryInfo.jsHeapSizeLimit,
                        totalJSHeapSize: memoryInfo.totalJSHeapSize,
                        usedJSHeapSize: memoryInfo.usedJSHeapSize
                    },
                    url: window.location.href,
                    timestamp: new Date().toISOString()
                });
            }, 30000); // 每30秒采集一次
        }
    }
    startFrameRateMonitoring() {
        let lastTime = performance.now();
        let frames = 0;
        const calculateFPS = () => {
            const now = performance.now();
            const delta = now - lastTime;
            if (delta >= 1000) {
                const fps = Math.round((frames * 1000) / delta);
                this.reportService.reportPerformance({
                    type: 'fps',
                    metrics: { fps },
                    url: window.location.href,
                    timestamp: new Date().toISOString()
                });
                frames = 0;
                lastTime = now;
            }
            frames++;
            requestAnimationFrame(calculateFPS);
        };
        requestAnimationFrame(calculateFPS);
    }
    observeResourceTiming() {
        this.resourceObserver = new PerformanceObserver(list => {
            const entries = list.getEntries();
            entries.forEach(entry => {
                if (['script', 'link', 'img', 'css', 'fetch', 'xmlhttprequest'].includes(entry.initiatorType)) {
                    this.reportService.reportPerformance({
                        type: 'resource',
                        metrics: {
                            name: entry.name,
                            initiatorType: entry.initiatorType,
                            duration: entry.duration,
                            transferSize: entry.transferSize || 0,
                            decodedBodySize: entry.decodedBodySize || 0
                        },
                        url: window.location.href,
                        timestamp: new Date().toISOString()
                    });
                }
            });
        });
        this.resourceObserver.observe({ entryTypes: ['resource'] });
    }
    observeLongTasks() {
        if ('PerformanceLongTaskTiming' in window) {
            this.longTaskObserver = new PerformanceObserver(list => {
                const entries = list.getEntries();
                entries.forEach(entry => {
                    if (entry.duration > this.config.longTaskThreshold) {
                        this.reportService.reportPerformance({
                            type: 'long_task',
                            metrics: {
                                duration: entry.duration,
                                startTime: entry.startTime
                            },
                            url: window.location.href,
                            timestamp: new Date().toISOString()
                        });
                    }
                });
            });
            this.longTaskObserver.observe({ entryTypes: ['longtask'] });
        }
    }
    captureWebVitals() {
        if (this.config.captureFirstContentfulPaint) {
            this.captureFCP();
        }
        if (this.config.captureLargestContentfulPaint) {
            this.captureLCP();
        }
        if (this.config.captureFirstInputDelay) {
            this.captureFID();
        }
        if (this.config.captureCumulativeLayoutShift) {
            this.captureCLS();
        }
    }
    captureFCP() {
        const fcpObserver = new PerformanceObserver(list => {
            const entries = list.getEntries();
            entries.forEach(entry => {
                this.reportService.reportPerformance({
                    type: 'web_vital',
                    name: 'FCP',
                    metrics: {
                        value: entry.startTime,
                        rating: this.getRating('FCP', entry.startTime)
                    },
                    url: window.location.href,
                    timestamp: new Date().toISOString()
                });
            });
            fcpObserver.disconnect();
        });
        fcpObserver.observe({ type: 'paint', buffered: true });
    }
    captureLCP() {
        let lcp = null;
        const lcpObserver = new PerformanceObserver(list => {
            const entries = list.getEntries();
            // 取最后一个 LCP 事件
            lcp = entries[entries.length - 1];
        });
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
        // 页面卸载时报告最终 LCP 值
        window.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && lcp) {
                this.reportService.reportPerformance({
                    type: 'web_vital',
                    name: 'LCP',
                    metrics: {
                        value: lcp.startTime,
                        rating: this.getRating('LCP', lcp.startTime),
                        element: lcp.element ? lcp.element.tagName : null
                    },
                    url: window.location.href,
                    timestamp: new Date().toISOString()
                });
                lcpObserver.disconnect();
            }
        });
    }
    captureFID() {
        const fidObserver = new PerformanceObserver(list => {
            const entries = list.getEntries();
            entries.forEach(entry => {
                // Cast to PerformanceEventTiming to access processingStart
                this.reportService.reportPerformance({
                    type: 'web_vital',
                    name: 'FID',
                    metrics: {
                        value: entry.processingStart - entry.startTime,
                        rating: this.getRating('FID', entry.processingStart - entry.startTime)
                    },
                    url: window.location.href,
                    timestamp: new Date().toISOString()
                });
            });
        });
        fidObserver.observe({ type: 'first-input', buffered: true });
    }
    captureCLS() {
        let clsValue = 0;
        let clsEntries = [];
        const clsObserver = new PerformanceObserver(list => {
            const entries = list.getEntries();
            entries.forEach(entry => {
                // 不计算用户交互后 500ms 内的布局偏移
                if (!entry.hadRecentInput) {
                    clsValue += entry.value;
                    clsEntries.push(entry);
                }
            });
        });
        clsObserver.observe({ type: 'layout-shift', buffered: true });
        // 页面卸载时报告累积的 CLS 值
        window.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.reportService.reportPerformance({
                    type: 'web_vital',
                    name: 'CLS',
                    metrics: {
                        value: clsValue,
                        rating: this.getRating('CLS', clsValue),
                        entries: clsEntries.length
                    },
                    url: window.location.href,
                    timestamp: new Date().toISOString()
                });
            }
        });
    }
    getRating(metric, value) {
        switch (metric) {
            case 'FCP':
                return value <= 1800 ? 'good' : value <= 3000 ? 'needs-improvement' : 'poor';
            case 'LCP':
                return value <= 2500 ? 'good' : value <= 4000 ? 'needs-improvement' : 'poor';
            case 'FID':
                return value <= 100 ? 'good' : value <= 300 ? 'needs-improvement' : 'poor';
            case 'CLS':
                return value <= 0.1 ? 'good' : value <= 0.25 ? 'needs-improvement' : 'poor';
            default:
                return 'needs-improvement';
        }
    }
    destroy() {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
        }
        if (this.frameRateInterval) {
            clearInterval(this.frameRateInterval);
        }
        if (this.longTaskObserver) {
            this.longTaskObserver.disconnect();
        }
        if (this.resourceObserver) {
            this.resourceObserver.disconnect();
        }
    }
}

class RouteMonitor {
    constructor(router, reportService, traceManager, config) {
        this.routeStartTime = 0;
        this.currentRoute = '';
        this.router = router;
        this.reportService = reportService;
        this.traceManager = traceManager;
        this.config = config;
        this.init();
    }
    init() {
        // 路由开始变化前
        this.router.beforeEach((to, from, next) => {
            // 记录路由开始时间
            this.routeStartTime = performance.now();
            // 生成新的 traceId 用于跟踪整个页面生命周期
            const traceId = this.traceManager.generateTraceId();
            this.traceManager.setTraceId(traceId);
            // 记录当前路由
            this.currentRoute = to.fullPath;
            // 上报路由开始事件
            this.reportRouteChange('route_start', to, from);
            next();
        });
        // 路由变化后
        this.router.afterEach((to, from) => {
            const duration = performance.now() - this.routeStartTime;
            // 上报路由完成事件
            this.reportRouteChange('route_complete', to, from, duration);
        });
        // 路由错误
        this.router.onError(error => {
            this.reportService.reportError({
                type: 'route_error',
                message: error.message,
                stack: error.stack,
                url: window.location.href,
                route: this.currentRoute,
                traceId: this.traceManager.getTraceId(),
                timestamp: new Date().toISOString()
            });
        });
    }
    reportRouteChange(eventType, to, from, duration) {
        // 检查是否应该忽略此路径
        if (this.config.ignorePaths && this.config.ignorePaths.some(path => to.path.includes(path))) {
            return;
        }
        const reportData = {
            type: eventType,
            from: this.sanitizeRouteData(from),
            to: this.sanitizeRouteData(to),
            timestamp: new Date().toISOString(),
            traceId: this.traceManager.getTraceId()
        };
        if (duration !== undefined) {
            reportData.duration = duration;
        }
        this.reportService.reportPerformance(reportData);
    }
    sanitizeRouteData(route) {
        if (!route)
            return null;
        const result = {
            path: route.path,
            name: route.name
        };
        if (this.config.captureParams) {
            result.params = route.params;
        }
        if (this.config.captureQuery) {
            result.query = route.query;
        }
        if (this.config.captureHash) {
            result.hash = route.hash;
        }
        return result;
    }
}

class StateMonitor {
    constructor(reportService, config) {
        this.stateSnapshotInterval = null;
        this.reportService = reportService;
        this.config = config;
        this.init();
    }
    init() {
        // 监控 Vuex
        if (this.config.vuex && this.config.captureState) {
            this.setupVuexMonitoring();
        }
        // 监控 Pinia
        if (this.config.pinia && this.config.captureState) {
            this.setupPiniaMonitoring();
        }
        // 定期捕获状态快照
        if (this.config.stateSnapshotInterval > 0) {
            this.startStateSnapshotCapture();
        }
    }
    setupVuexMonitoring() {
        const store = this.config.vuex;
        if (this.config.captureActions) {
            store.subscribeAction({
                before: (action) => {
                    this.reportStateChange('vuex_action_before', action.type, action.payload);
                },
                after: (action) => {
                    this.reportStateChange('vuex_action_after', action.type, action.payload);
                },
                error: (action, error) => {
                    this.reportStateError('vuex_action_error', action.type, error);
                }
            });
        }
        if (this.config.captureMutations) {
            store.subscribe((mutation) => {
                this.reportStateChange('vuex_mutation', mutation.type, mutation.payload);
            });
        }
    }
    setupPiniaMonitoring() {
        const pinia = this.config.pinia;
        // 监听所有 store 的变化
        pinia.use(({ store }) => {
            // 监听 actions
            if (this.config.captureActions) {
                store.$onAction(({ name, args, after, onError }) => {
                    this.reportStateChange('pinia_action_before', `${store.$id}/${name}`, args[0]);
                    after((result) => {
                        this.reportStateChange('pinia_action_after', `${store.$id}/${name}`, result);
                    });
                    onError((error) => {
                        this.reportStateError('pinia_action_error', `${store.$id}/${name}`, error);
                    });
                });
            }
            // 监听 state 变化
            if (this.config.captureMutations) {
                store.$subscribe((mutation) => {
                    this.reportStateChange('pinia_state_change', store.$id, {
                        type: mutation.type,
                        events: mutation.events
                    });
                });
            }
        });
    }
    startStateSnapshotCapture() {
        this.stateSnapshotInterval = window.setInterval(() => {
            let stateSnapshot = {};
            // 捕获 Vuex 状态
            if (this.config.vuex) {
                stateSnapshot.vuex = this.sanitizeState(this.config.vuex.state);
            }
            // 捕获 Pinia 状态
            if (this.config.pinia) {
                stateSnapshot.pinia = {};
                const stores = Object.keys(this.config.pinia.state.value);
                stores.forEach(storeId => {
                    stateSnapshot.pinia[storeId] = this.sanitizeState(this.config.pinia.state.value[storeId]);
                });
            }
            this.reportService.reportPerformance({
                type: 'state_snapshot',
                state: stateSnapshot,
                timestamp: new Date().toISOString()
            });
        }, this.config.stateSnapshotInterval);
    }
    reportStateChange(type, action, payload) {
        this.reportService.reportPerformance({
            type,
            action,
            payload: this.sanitizePayload(payload),
            timestamp: new Date().toISOString()
        });
    }
    reportStateError(type, action, error) {
        this.reportService.reportError({
            type,
            action,
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
    }
    sanitizeState(state) {
        if (!state)
            return null;
        try {
            const serialized = JSON.stringify(state);
            // 检查状态大小是否超过限制
            if (serialized.length > this.config.maxStateSize) {
                return {
                    _truncated: true,
                    _size: serialized.length,
                    _keys: Object.keys(state)
                };
            }
            return JSON.parse(serialized);
        }
        catch (e) {
            // 如果状态无法序列化，返回键列表
            return {
                _error: 'Cannot serialize state',
                _keys: Object.keys(state)
            };
        }
    }
    sanitizePayload(payload) {
        if (!payload)
            return null;
        try {
            return JSON.parse(JSON.stringify(payload));
        }
        catch (e) {
            return {
                _error: 'Cannot serialize payload',
                _type: typeof payload
            };
        }
    }
    destroy() {
        if (this.stateSnapshotInterval) {
            clearInterval(this.stateSnapshotInterval);
        }
    }
}

class ReportService {
    constructor(config) {
        this.queue = [];
        this.sending = false;
        this.batchInterval = null;
        this.offlineQueue = [];
        this.isOnline = navigator.onLine;
        this.config = config;
        this.init();
    }
    init() {
        // 设置批量上报定时器
        if (this.config.batchReport) {
            this.batchInterval = window.setInterval(() => {
                this.processBatch();
            }, this.config.batchInterval);
        }
        // 监听网络状态变化
        window.addEventListener('online', this.handleOnline.bind(this));
        window.addEventListener('offline', this.handleOffline.bind(this));
        // 页面卸载前尝试发送所有数据
        window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    }
    reportError(data) {
        // 采样率过滤
        if (Math.random() > (this.config.sampleRate || 1)) {
            return;
        }
        // 根据日志级别过滤
        if (this.config.reportLevel === 'error' && data.level !== 'error') {
            return;
        }
        const reportItem = {
            id: this.generateId(),
            data: {
                ...data,
                appId: this.config.appId,
                appVersion: this.config.appVersion,
                environment: this.config.environment,
                category: 'error',
            },
            timestamp: Date.now(),
            retryCount: 0,
        };
        // 前置处理钩子
        if (this.config.beforeReport) {
            const processedData = this.config.beforeReport(reportItem.data);
            if (processedData === false) {
                return; // 被钩子函数拦截
            }
            if (processedData) {
                reportItem.data = processedData;
            }
        }
        // 集成第三方服务
        this.sendToIntegrations(reportItem.data);
        // 添加到队列
        if (this.config.batchReport) {
            this.queue.push(reportItem);
            // 如果队列达到批处理大小，立即处理
            if (this.queue.length >= this.config.batchSize) {
                this.processBatch();
            }
        }
        else {
            this.sendReport(reportItem);
        }
    }
    reportPerformance(data) {
        // 采样率过滤
        if (Math.random() > (this.config.sampleRate || 1)) {
            return;
        }
        const reportItem = {
            id: this.generateId(),
            data: {
                ...data,
                appId: this.config.appId,
                appVersion: this.config.appVersion,
                environment: this.config.environment,
                category: 'performance',
            },
            timestamp: Date.now(),
            retryCount: 0,
        };
        // 前置处理钩子
        if (this.config.beforeReport) {
            const processedData = this.config.beforeReport(reportItem.data);
            if (processedData === false) {
                return; // 被钩子函数拦截
            }
            if (processedData) {
                reportItem.data = processedData;
            }
        }
        // 添加到队列
        if (this.config.batchReport) {
            this.queue.push(reportItem);
        }
        else {
            this.sendReport(reportItem);
        }
    }
    processBatch() {
        if (this.sending || this.queue.length === 0) {
            return;
        }
        this.sending = true;
        // 取出当前批次的数据
        const batch = this.queue.splice(0, this.config.batchSize);
        // 如果离线，添加到离线队列
        if (!this.isOnline) {
            this.offlineQueue.push(...batch);
            this.sending = false;
            return;
        }
        // 发送批量数据
        this.sendBatchReport(batch)
            .catch(() => {
            // 发送失败，重新加入队列等待重试
            batch.forEach((item) => {
                item.retryCount++;
                if (item.retryCount <= this.config.maxRetryCount) {
                    this.queue.unshift(item);
                }
            });
        })
            .finally(() => {
            this.sending = false;
            // 如果队列中还有数据，继续处理
            if (this.queue.length > 0) {
                setTimeout(() => this.processBatch(), 0);
            }
        });
    }
    async sendBatchReport(batch) {
        try {
            const response = await fetch(this.config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.config.headers,
                },
                body: JSON.stringify({
                    batch: batch.map((item) => item.data),
                    timestamp: Date.now(),
                }),
                // 在页面卸载时使用 keepalive
                keepalive: true,
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        }
        catch (error) {
            console.error('Error sending batch report:', error);
            throw error;
        }
    }
    async sendReport(item) {
        // 如果离线，添加到离线队列
        if (!this.isOnline) {
            this.offlineQueue.push(item);
            return;
        }
        try {
            // 尝试使用 Beacon API (适用于页面卸载时)
            if (this.config.useBeacon && navigator.sendBeacon) {
                const blob = new Blob([JSON.stringify(item.data)], {
                    type: 'application/json',
                });
                const success = navigator.sendBeacon(this.config.endpoint, blob);
                if (success) {
                    return;
                }
            }
            // 回退到 fetch
            const response = await fetch(this.config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.config.headers,
                },
                body: JSON.stringify(item.data),
                // 在页面卸载时使用 keepalive
                keepalive: true,
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        }
        catch (error) {
            console.error('Error sending report:', error);
            // 重试逻辑
            item.retryCount++;
            if (item.retryCount <= this.config.maxRetryCount) {
                setTimeout(() => {
                    this.sendReport(item);
                }, this.config.retryInterval);
            }
        }
    }
    handleOnline() {
        this.isOnline = true;
        // 尝试发送离线队列中的数据
        if (this.offlineQueue.length > 0) {
            const offlineItems = [...this.offlineQueue];
            this.offlineQueue = [];
            // 将离线数据重新加入队列
            if (this.config.batchReport) {
                this.queue.unshift(...offlineItems);
                this.processBatch();
            }
            else {
                offlineItems.forEach((item) => this.sendReport(item));
            }
        }
    }
    handleOffline() {
        this.isOnline = false;
    }
    handleBeforeUnload() {
        // 清除批处理定时器
        if (this.batchInterval) {
            clearInterval(this.batchInterval);
        }
        // 尝试发送所有剩余数据
        if (this.queue.length > 0 && this.isOnline) {
            // 使用 sendBeacon 发送剩余数据
            if (navigator.sendBeacon && this.config.useBeacon) {
                const blob = new Blob([
                    JSON.stringify({
                        batch: this.queue.map((item) => item.data),
                        timestamp: Date.now(),
                    }),
                ], { type: 'application/json' });
                navigator.sendBeacon(this.config.endpoint, blob);
            }
        }
    }
    sendToIntegrations(data) {
        var _a, _b, _c;
        const integrations = this.config.integrations;
        if (!integrations)
            return;
        // Sentry 集成
        if (((_a = integrations.sentry) === null || _a === void 0 ? void 0 : _a.enabled) && window.Sentry) {
            try {
                window.Sentry.captureException(data.error || new Error(data.message), {
                    extra: data,
                });
            }
            catch (e) {
                console.error('Failed to send to Sentry:', e);
            }
        }
        // LogRocket 集成
        if (((_b = integrations.logRocket) === null || _b === void 0 ? void 0 : _b.enabled) && window.LogRocket) {
            try {
                window.LogRocket.captureException(data.error || new Error(data.message), {
                    extra: data,
                });
            }
            catch (e) {
                console.error('Failed to send to LogRocket:', e);
            }
        }
        // 阿里云日志服务集成
        if (((_c = integrations.aliyunSls) === null || _c === void 0 ? void 0 : _c.enabled) && window.AliyunSLS) {
            try {
                window.AliyunSLS.send({
                    project: integrations.aliyunSls.project,
                    logstore: integrations.aliyunSls.logstore,
                    time: Math.floor(Date.now() / 1000),
                    contents: this.flattenObject(data),
                });
            }
            catch (e) {
                console.error('Failed to send to Aliyun SLS:', e);
            }
        }
    }
    flattenObject(obj, prefix = '') {
        const result = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const value = obj[key];
                const newKey = prefix ? `${prefix}.${key}` : key;
                if (typeof value === 'object' && value !== null) {
                    Object.assign(result, this.flattenObject(value, newKey));
                }
                else {
                    result[newKey] = String(value);
                }
            }
        }
        return result;
    }
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }
    destroy() {
        if (this.batchInterval) {
            clearInterval(this.batchInterval);
        }
        window.removeEventListener('online', this.handleOnline.bind(this));
        window.removeEventListener('offline', this.handleOffline.bind(this));
        window.removeEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    }
}

var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

var stacktrace = {exports: {}};

var errorStackParser = {exports: {}};

var hasRequiredErrorStackParser;

function requireErrorStackParser () {
	if (hasRequiredErrorStackParser) return errorStackParser.exports;
	hasRequiredErrorStackParser = 1;
	(function (module, exports) {
		(function(root, factory) {
		    // Universal Module Definition (UMD) to support AMD, CommonJS/Node.js, Rhino, and browsers.

		    /* istanbul ignore next */
		    {
		        module.exports = factory(require$$0__default["default"]);
		    }
		}(commonjsGlobal, function ErrorStackParser(StackFrame) {

		    var FIREFOX_SAFARI_STACK_REGEXP = /(^|@)\S+:\d+/;
		    var CHROME_IE_STACK_REGEXP = /^\s*at .*(\S+:\d+|\(native\))/m;
		    var SAFARI_NATIVE_CODE_REGEXP = /^(eval@)?(\[native code])?$/;

		    return {
		        /**
		         * Given an Error object, extract the most information from it.
		         *
		         * @param {Error} error object
		         * @return {Array} of StackFrames
		         */
		        parse: function ErrorStackParser$$parse(error) {
		            if (typeof error.stacktrace !== 'undefined' || typeof error['opera#sourceloc'] !== 'undefined') {
		                return this.parseOpera(error);
		            } else if (error.stack && error.stack.match(CHROME_IE_STACK_REGEXP)) {
		                return this.parseV8OrIE(error);
		            } else if (error.stack) {
		                return this.parseFFOrSafari(error);
		            } else {
		                throw new Error('Cannot parse given Error object');
		            }
		        },

		        // Separate line and column numbers from a string of the form: (URI:Line:Column)
		        extractLocation: function ErrorStackParser$$extractLocation(urlLike) {
		            // Fail-fast but return locations like "(native)"
		            if (urlLike.indexOf(':') === -1) {
		                return [urlLike];
		            }

		            var regExp = /(.+?)(?::(\d+))?(?::(\d+))?$/;
		            var parts = regExp.exec(urlLike.replace(/[()]/g, ''));
		            return [parts[1], parts[2] || undefined, parts[3] || undefined];
		        },

		        parseV8OrIE: function ErrorStackParser$$parseV8OrIE(error) {
		            var filtered = error.stack.split('\n').filter(function(line) {
		                return !!line.match(CHROME_IE_STACK_REGEXP);
		            }, this);

		            return filtered.map(function(line) {
		                if (line.indexOf('(eval ') > -1) {
		                    // Throw away eval information until we implement stacktrace.js/stackframe#8
		                    line = line.replace(/eval code/g, 'eval').replace(/(\(eval at [^()]*)|(,.*$)/g, '');
		                }
		                var sanitizedLine = line.replace(/^\s+/, '').replace(/\(eval code/g, '(').replace(/^.*?\s+/, '');

		                // capture and preseve the parenthesized location "(/foo/my bar.js:12:87)" in
		                // case it has spaces in it, as the string is split on \s+ later on
		                var location = sanitizedLine.match(/ (\(.+\)$)/);

		                // remove the parenthesized location from the line, if it was matched
		                sanitizedLine = location ? sanitizedLine.replace(location[0], '') : sanitizedLine;

		                // if a location was matched, pass it to extractLocation() otherwise pass all sanitizedLine
		                // because this line doesn't have function name
		                var locationParts = this.extractLocation(location ? location[1] : sanitizedLine);
		                var functionName = location && sanitizedLine || undefined;
		                var fileName = ['eval', '<anonymous>'].indexOf(locationParts[0]) > -1 ? undefined : locationParts[0];

		                return new StackFrame({
		                    functionName: functionName,
		                    fileName: fileName,
		                    lineNumber: locationParts[1],
		                    columnNumber: locationParts[2],
		                    source: line
		                });
		            }, this);
		        },

		        parseFFOrSafari: function ErrorStackParser$$parseFFOrSafari(error) {
		            var filtered = error.stack.split('\n').filter(function(line) {
		                return !line.match(SAFARI_NATIVE_CODE_REGEXP);
		            }, this);

		            return filtered.map(function(line) {
		                // Throw away eval information until we implement stacktrace.js/stackframe#8
		                if (line.indexOf(' > eval') > -1) {
		                    line = line.replace(/ line (\d+)(?: > eval line \d+)* > eval:\d+:\d+/g, ':$1');
		                }

		                if (line.indexOf('@') === -1 && line.indexOf(':') === -1) {
		                    // Safari eval frames only have function names and nothing else
		                    return new StackFrame({
		                        functionName: line
		                    });
		                } else {
		                    var functionNameRegex = /((.*".+"[^@]*)?[^@]*)(?:@)/;
		                    var matches = line.match(functionNameRegex);
		                    var functionName = matches && matches[1] ? matches[1] : undefined;
		                    var locationParts = this.extractLocation(line.replace(functionNameRegex, ''));

		                    return new StackFrame({
		                        functionName: functionName,
		                        fileName: locationParts[0],
		                        lineNumber: locationParts[1],
		                        columnNumber: locationParts[2],
		                        source: line
		                    });
		                }
		            }, this);
		        },

		        parseOpera: function ErrorStackParser$$parseOpera(e) {
		            if (!e.stacktrace || (e.message.indexOf('\n') > -1 &&
		                e.message.split('\n').length > e.stacktrace.split('\n').length)) {
		                return this.parseOpera9(e);
		            } else if (!e.stack) {
		                return this.parseOpera10(e);
		            } else {
		                return this.parseOpera11(e);
		            }
		        },

		        parseOpera9: function ErrorStackParser$$parseOpera9(e) {
		            var lineRE = /Line (\d+).*script (?:in )?(\S+)/i;
		            var lines = e.message.split('\n');
		            var result = [];

		            for (var i = 2, len = lines.length; i < len; i += 2) {
		                var match = lineRE.exec(lines[i]);
		                if (match) {
		                    result.push(new StackFrame({
		                        fileName: match[2],
		                        lineNumber: match[1],
		                        source: lines[i]
		                    }));
		                }
		            }

		            return result;
		        },

		        parseOpera10: function ErrorStackParser$$parseOpera10(e) {
		            var lineRE = /Line (\d+).*script (?:in )?(\S+)(?:: In function (\S+))?$/i;
		            var lines = e.stacktrace.split('\n');
		            var result = [];

		            for (var i = 0, len = lines.length; i < len; i += 2) {
		                var match = lineRE.exec(lines[i]);
		                if (match) {
		                    result.push(
		                        new StackFrame({
		                            functionName: match[3] || undefined,
		                            fileName: match[2],
		                            lineNumber: match[1],
		                            source: lines[i]
		                        })
		                    );
		                }
		            }

		            return result;
		        },

		        // Opera 10.65+ Error.stack very similar to FF/Safari
		        parseOpera11: function ErrorStackParser$$parseOpera11(error) {
		            var filtered = error.stack.split('\n').filter(function(line) {
		                return !!line.match(FIREFOX_SAFARI_STACK_REGEXP) && !line.match(/^Error created at/);
		            }, this);

		            return filtered.map(function(line) {
		                var tokens = line.split('@');
		                var locationParts = this.extractLocation(tokens.pop());
		                var functionCall = (tokens.shift() || '');
		                var functionName = functionCall
		                    .replace(/<anonymous function(: (\w+))?>/, '$2')
		                    .replace(/\([^)]*\)/g, '') || undefined;
		                var argsRaw;
		                if (functionCall.match(/\(([^)]*)\)/)) {
		                    argsRaw = functionCall.replace(/^[^(]+\(([^)]*)\)$/, '$1');
		                }
		                var args = (argsRaw === undefined || argsRaw === '[arguments not available]') ?
		                    undefined : argsRaw.split(',');

		                return new StackFrame({
		                    functionName: functionName,
		                    args: args,
		                    fileName: locationParts[0],
		                    lineNumber: locationParts[1],
		                    columnNumber: locationParts[2],
		                    source: line
		                });
		            }, this);
		        }
		    };
		}));
} (errorStackParser));
	return errorStackParser.exports;
}

var stacktraceGps = {exports: {}};

var sourceMapConsumer = {};

var util = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

var hasRequiredUtil;

function requireUtil () {
	if (hasRequiredUtil) return util;
	hasRequiredUtil = 1;
	(function (exports) {
		/*
		 * Copyright 2011 Mozilla Foundation and contributors
		 * Licensed under the New BSD license. See LICENSE or:
		 * http://opensource.org/licenses/BSD-3-Clause
		 */

		/**
		 * This is a helper function for getting values from parameter/options
		 * objects.
		 *
		 * @param args The object we are extracting values from
		 * @param name The name of the property we are getting.
		 * @param defaultValue An optional value to return if the property is missing
		 * from the object. If this is not specified and the property is missing, an
		 * error will be thrown.
		 */
		function getArg(aArgs, aName, aDefaultValue) {
		  if (aName in aArgs) {
		    return aArgs[aName];
		  } else if (arguments.length === 3) {
		    return aDefaultValue;
		  } else {
		    throw new Error('"' + aName + '" is a required argument.');
		  }
		}
		exports.getArg = getArg;

		var urlRegexp = /^(?:([\w+\-.]+):)?\/\/(?:(\w+:\w+)@)?([\w.]*)(?::(\d+))?(\S*)$/;
		var dataUrlRegexp = /^data:.+\,.+$/;

		function urlParse(aUrl) {
		  var match = aUrl.match(urlRegexp);
		  if (!match) {
		    return null;
		  }
		  return {
		    scheme: match[1],
		    auth: match[2],
		    host: match[3],
		    port: match[4],
		    path: match[5]
		  };
		}
		exports.urlParse = urlParse;

		function urlGenerate(aParsedUrl) {
		  var url = '';
		  if (aParsedUrl.scheme) {
		    url += aParsedUrl.scheme + ':';
		  }
		  url += '//';
		  if (aParsedUrl.auth) {
		    url += aParsedUrl.auth + '@';
		  }
		  if (aParsedUrl.host) {
		    url += aParsedUrl.host;
		  }
		  if (aParsedUrl.port) {
		    url += ":" + aParsedUrl.port;
		  }
		  if (aParsedUrl.path) {
		    url += aParsedUrl.path;
		  }
		  return url;
		}
		exports.urlGenerate = urlGenerate;

		/**
		 * Normalizes a path, or the path portion of a URL:
		 *
		 * - Replaces consecutive slashes with one slash.
		 * - Removes unnecessary '.' parts.
		 * - Removes unnecessary '<dir>/..' parts.
		 *
		 * Based on code in the Node.js 'path' core module.
		 *
		 * @param aPath The path or url to normalize.
		 */
		function normalize(aPath) {
		  var path = aPath;
		  var url = urlParse(aPath);
		  if (url) {
		    if (!url.path) {
		      return aPath;
		    }
		    path = url.path;
		  }
		  var isAbsolute = exports.isAbsolute(path);

		  var parts = path.split(/\/+/);
		  for (var part, up = 0, i = parts.length - 1; i >= 0; i--) {
		    part = parts[i];
		    if (part === '.') {
		      parts.splice(i, 1);
		    } else if (part === '..') {
		      up++;
		    } else if (up > 0) {
		      if (part === '') {
		        // The first part is blank if the path is absolute. Trying to go
		        // above the root is a no-op. Therefore we can remove all '..' parts
		        // directly after the root.
		        parts.splice(i + 1, up);
		        up = 0;
		      } else {
		        parts.splice(i, 2);
		        up--;
		      }
		    }
		  }
		  path = parts.join('/');

		  if (path === '') {
		    path = isAbsolute ? '/' : '.';
		  }

		  if (url) {
		    url.path = path;
		    return urlGenerate(url);
		  }
		  return path;
		}
		exports.normalize = normalize;

		/**
		 * Joins two paths/URLs.
		 *
		 * @param aRoot The root path or URL.
		 * @param aPath The path or URL to be joined with the root.
		 *
		 * - If aPath is a URL or a data URI, aPath is returned, unless aPath is a
		 *   scheme-relative URL: Then the scheme of aRoot, if any, is prepended
		 *   first.
		 * - Otherwise aPath is a path. If aRoot is a URL, then its path portion
		 *   is updated with the result and aRoot is returned. Otherwise the result
		 *   is returned.
		 *   - If aPath is absolute, the result is aPath.
		 *   - Otherwise the two paths are joined with a slash.
		 * - Joining for example 'http://' and 'www.example.com' is also supported.
		 */
		function join(aRoot, aPath) {
		  if (aRoot === "") {
		    aRoot = ".";
		  }
		  if (aPath === "") {
		    aPath = ".";
		  }
		  var aPathUrl = urlParse(aPath);
		  var aRootUrl = urlParse(aRoot);
		  if (aRootUrl) {
		    aRoot = aRootUrl.path || '/';
		  }

		  // `join(foo, '//www.example.org')`
		  if (aPathUrl && !aPathUrl.scheme) {
		    if (aRootUrl) {
		      aPathUrl.scheme = aRootUrl.scheme;
		    }
		    return urlGenerate(aPathUrl);
		  }

		  if (aPathUrl || aPath.match(dataUrlRegexp)) {
		    return aPath;
		  }

		  // `join('http://', 'www.example.com')`
		  if (aRootUrl && !aRootUrl.host && !aRootUrl.path) {
		    aRootUrl.host = aPath;
		    return urlGenerate(aRootUrl);
		  }

		  var joined = aPath.charAt(0) === '/'
		    ? aPath
		    : normalize(aRoot.replace(/\/+$/, '') + '/' + aPath);

		  if (aRootUrl) {
		    aRootUrl.path = joined;
		    return urlGenerate(aRootUrl);
		  }
		  return joined;
		}
		exports.join = join;

		exports.isAbsolute = function (aPath) {
		  return aPath.charAt(0) === '/' || !!aPath.match(urlRegexp);
		};

		/**
		 * Make a path relative to a URL or another path.
		 *
		 * @param aRoot The root path or URL.
		 * @param aPath The path or URL to be made relative to aRoot.
		 */
		function relative(aRoot, aPath) {
		  if (aRoot === "") {
		    aRoot = ".";
		  }

		  aRoot = aRoot.replace(/\/$/, '');

		  // It is possible for the path to be above the root. In this case, simply
		  // checking whether the root is a prefix of the path won't work. Instead, we
		  // need to remove components from the root one by one, until either we find
		  // a prefix that fits, or we run out of components to remove.
		  var level = 0;
		  while (aPath.indexOf(aRoot + '/') !== 0) {
		    var index = aRoot.lastIndexOf("/");
		    if (index < 0) {
		      return aPath;
		    }

		    // If the only part of the root that is left is the scheme (i.e. http://,
		    // file:///, etc.), one or more slashes (/), or simply nothing at all, we
		    // have exhausted all components, so the path is not relative to the root.
		    aRoot = aRoot.slice(0, index);
		    if (aRoot.match(/^([^\/]+:\/)?\/*$/)) {
		      return aPath;
		    }

		    ++level;
		  }

		  // Make sure we add a "../" for each component we removed from the root.
		  return Array(level + 1).join("../") + aPath.substr(aRoot.length + 1);
		}
		exports.relative = relative;

		var supportsNullProto = (function () {
		  var obj = Object.create(null);
		  return !('__proto__' in obj);
		}());

		function identity (s) {
		  return s;
		}

		/**
		 * Because behavior goes wacky when you set `__proto__` on objects, we
		 * have to prefix all the strings in our set with an arbitrary character.
		 *
		 * See https://github.com/mozilla/source-map/pull/31 and
		 * https://github.com/mozilla/source-map/issues/30
		 *
		 * @param String aStr
		 */
		function toSetString(aStr) {
		  if (isProtoString(aStr)) {
		    return '$' + aStr;
		  }

		  return aStr;
		}
		exports.toSetString = supportsNullProto ? identity : toSetString;

		function fromSetString(aStr) {
		  if (isProtoString(aStr)) {
		    return aStr.slice(1);
		  }

		  return aStr;
		}
		exports.fromSetString = supportsNullProto ? identity : fromSetString;

		function isProtoString(s) {
		  if (!s) {
		    return false;
		  }

		  var length = s.length;

		  if (length < 9 /* "__proto__".length */) {
		    return false;
		  }

		  if (s.charCodeAt(length - 1) !== 95  /* '_' */ ||
		      s.charCodeAt(length - 2) !== 95  /* '_' */ ||
		      s.charCodeAt(length - 3) !== 111 /* 'o' */ ||
		      s.charCodeAt(length - 4) !== 116 /* 't' */ ||
		      s.charCodeAt(length - 5) !== 111 /* 'o' */ ||
		      s.charCodeAt(length - 6) !== 114 /* 'r' */ ||
		      s.charCodeAt(length - 7) !== 112 /* 'p' */ ||
		      s.charCodeAt(length - 8) !== 95  /* '_' */ ||
		      s.charCodeAt(length - 9) !== 95  /* '_' */) {
		    return false;
		  }

		  for (var i = length - 10; i >= 0; i--) {
		    if (s.charCodeAt(i) !== 36 /* '$' */) {
		      return false;
		    }
		  }

		  return true;
		}

		/**
		 * Comparator between two mappings where the original positions are compared.
		 *
		 * Optionally pass in `true` as `onlyCompareGenerated` to consider two
		 * mappings with the same original source/line/column, but different generated
		 * line and column the same. Useful when searching for a mapping with a
		 * stubbed out mapping.
		 */
		function compareByOriginalPositions(mappingA, mappingB, onlyCompareOriginal) {
		  var cmp = mappingA.source - mappingB.source;
		  if (cmp !== 0) {
		    return cmp;
		  }

		  cmp = mappingA.originalLine - mappingB.originalLine;
		  if (cmp !== 0) {
		    return cmp;
		  }

		  cmp = mappingA.originalColumn - mappingB.originalColumn;
		  if (cmp !== 0 || onlyCompareOriginal) {
		    return cmp;
		  }

		  cmp = mappingA.generatedColumn - mappingB.generatedColumn;
		  if (cmp !== 0) {
		    return cmp;
		  }

		  cmp = mappingA.generatedLine - mappingB.generatedLine;
		  if (cmp !== 0) {
		    return cmp;
		  }

		  return mappingA.name - mappingB.name;
		}
		exports.compareByOriginalPositions = compareByOriginalPositions;

		/**
		 * Comparator between two mappings with deflated source and name indices where
		 * the generated positions are compared.
		 *
		 * Optionally pass in `true` as `onlyCompareGenerated` to consider two
		 * mappings with the same generated line and column, but different
		 * source/name/original line and column the same. Useful when searching for a
		 * mapping with a stubbed out mapping.
		 */
		function compareByGeneratedPositionsDeflated(mappingA, mappingB, onlyCompareGenerated) {
		  var cmp = mappingA.generatedLine - mappingB.generatedLine;
		  if (cmp !== 0) {
		    return cmp;
		  }

		  cmp = mappingA.generatedColumn - mappingB.generatedColumn;
		  if (cmp !== 0 || onlyCompareGenerated) {
		    return cmp;
		  }

		  cmp = mappingA.source - mappingB.source;
		  if (cmp !== 0) {
		    return cmp;
		  }

		  cmp = mappingA.originalLine - mappingB.originalLine;
		  if (cmp !== 0) {
		    return cmp;
		  }

		  cmp = mappingA.originalColumn - mappingB.originalColumn;
		  if (cmp !== 0) {
		    return cmp;
		  }

		  return mappingA.name - mappingB.name;
		}
		exports.compareByGeneratedPositionsDeflated = compareByGeneratedPositionsDeflated;

		function strcmp(aStr1, aStr2) {
		  if (aStr1 === aStr2) {
		    return 0;
		  }

		  if (aStr1 > aStr2) {
		    return 1;
		  }

		  return -1;
		}

		/**
		 * Comparator between two mappings with inflated source and name strings where
		 * the generated positions are compared.
		 */
		function compareByGeneratedPositionsInflated(mappingA, mappingB) {
		  var cmp = mappingA.generatedLine - mappingB.generatedLine;
		  if (cmp !== 0) {
		    return cmp;
		  }

		  cmp = mappingA.generatedColumn - mappingB.generatedColumn;
		  if (cmp !== 0) {
		    return cmp;
		  }

		  cmp = strcmp(mappingA.source, mappingB.source);
		  if (cmp !== 0) {
		    return cmp;
		  }

		  cmp = mappingA.originalLine - mappingB.originalLine;
		  if (cmp !== 0) {
		    return cmp;
		  }

		  cmp = mappingA.originalColumn - mappingB.originalColumn;
		  if (cmp !== 0) {
		    return cmp;
		  }

		  return strcmp(mappingA.name, mappingB.name);
		}
		exports.compareByGeneratedPositionsInflated = compareByGeneratedPositionsInflated;
} (util));
	return util;
}

var binarySearch = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

var hasRequiredBinarySearch;

function requireBinarySearch () {
	if (hasRequiredBinarySearch) return binarySearch;
	hasRequiredBinarySearch = 1;
	(function (exports) {
		/*
		 * Copyright 2011 Mozilla Foundation and contributors
		 * Licensed under the New BSD license. See LICENSE or:
		 * http://opensource.org/licenses/BSD-3-Clause
		 */

		exports.GREATEST_LOWER_BOUND = 1;
		exports.LEAST_UPPER_BOUND = 2;

		/**
		 * Recursive implementation of binary search.
		 *
		 * @param aLow Indices here and lower do not contain the needle.
		 * @param aHigh Indices here and higher do not contain the needle.
		 * @param aNeedle The element being searched for.
		 * @param aHaystack The non-empty array being searched.
		 * @param aCompare Function which takes two elements and returns -1, 0, or 1.
		 * @param aBias Either 'binarySearch.GREATEST_LOWER_BOUND' or
		 *     'binarySearch.LEAST_UPPER_BOUND'. Specifies whether to return the
		 *     closest element that is smaller than or greater than the one we are
		 *     searching for, respectively, if the exact element cannot be found.
		 */
		function recursiveSearch(aLow, aHigh, aNeedle, aHaystack, aCompare, aBias) {
		  // This function terminates when one of the following is true:
		  //
		  //   1. We find the exact element we are looking for.
		  //
		  //   2. We did not find the exact element, but we can return the index of
		  //      the next-closest element.
		  //
		  //   3. We did not find the exact element, and there is no next-closest
		  //      element than the one we are searching for, so we return -1.
		  var mid = Math.floor((aHigh - aLow) / 2) + aLow;
		  var cmp = aCompare(aNeedle, aHaystack[mid], true);
		  if (cmp === 0) {
		    // Found the element we are looking for.
		    return mid;
		  }
		  else if (cmp > 0) {
		    // Our needle is greater than aHaystack[mid].
		    if (aHigh - mid > 1) {
		      // The element is in the upper half.
		      return recursiveSearch(mid, aHigh, aNeedle, aHaystack, aCompare, aBias);
		    }

		    // The exact needle element was not found in this haystack. Determine if
		    // we are in termination case (3) or (2) and return the appropriate thing.
		    if (aBias == exports.LEAST_UPPER_BOUND) {
		      return aHigh < aHaystack.length ? aHigh : -1;
		    } else {
		      return mid;
		    }
		  }
		  else {
		    // Our needle is less than aHaystack[mid].
		    if (mid - aLow > 1) {
		      // The element is in the lower half.
		      return recursiveSearch(aLow, mid, aNeedle, aHaystack, aCompare, aBias);
		    }

		    // we are in termination case (3) or (2) and return the appropriate thing.
		    if (aBias == exports.LEAST_UPPER_BOUND) {
		      return mid;
		    } else {
		      return aLow < 0 ? -1 : aLow;
		    }
		  }
		}

		/**
		 * This is an implementation of binary search which will always try and return
		 * the index of the closest element if there is no exact hit. This is because
		 * mappings between original and generated line/col pairs are single points,
		 * and there is an implicit region between each of them, so a miss just means
		 * that you aren't on the very start of a region.
		 *
		 * @param aNeedle The element you are looking for.
		 * @param aHaystack The array that is being searched.
		 * @param aCompare A function which takes the needle and an element in the
		 *     array and returns -1, 0, or 1 depending on whether the needle is less
		 *     than, equal to, or greater than the element, respectively.
		 * @param aBias Either 'binarySearch.GREATEST_LOWER_BOUND' or
		 *     'binarySearch.LEAST_UPPER_BOUND'. Specifies whether to return the
		 *     closest element that is smaller than or greater than the one we are
		 *     searching for, respectively, if the exact element cannot be found.
		 *     Defaults to 'binarySearch.GREATEST_LOWER_BOUND'.
		 */
		exports.search = function search(aNeedle, aHaystack, aCompare, aBias) {
		  if (aHaystack.length === 0) {
		    return -1;
		  }

		  var index = recursiveSearch(-1, aHaystack.length, aNeedle, aHaystack,
		                              aCompare, aBias || exports.GREATEST_LOWER_BOUND);
		  if (index < 0) {
		    return -1;
		  }

		  // We have found either the exact element, or the next-closest element than
		  // the one we are searching for. However, there may be more than one such
		  // element. Make sure we always return the smallest of these.
		  while (index - 1 >= 0) {
		    if (aCompare(aHaystack[index], aHaystack[index - 1], true) !== 0) {
		      break;
		    }
		    --index;
		  }

		  return index;
		};
} (binarySearch));
	return binarySearch;
}

var arraySet = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

var hasRequiredArraySet;

function requireArraySet () {
	if (hasRequiredArraySet) return arraySet;
	hasRequiredArraySet = 1;
	/*
	 * Copyright 2011 Mozilla Foundation and contributors
	 * Licensed under the New BSD license. See LICENSE or:
	 * http://opensource.org/licenses/BSD-3-Clause
	 */

	var util = requireUtil();
	var has = Object.prototype.hasOwnProperty;

	/**
	 * A data structure which is a combination of an array and a set. Adding a new
	 * member is O(1), testing for membership is O(1), and finding the index of an
	 * element is O(1). Removing elements from the set is not supported. Only
	 * strings are supported for membership.
	 */
	function ArraySet() {
	  this._array = [];
	  this._set = Object.create(null);
	}

	/**
	 * Static method for creating ArraySet instances from an existing array.
	 */
	ArraySet.fromArray = function ArraySet_fromArray(aArray, aAllowDuplicates) {
	  var set = new ArraySet();
	  for (var i = 0, len = aArray.length; i < len; i++) {
	    set.add(aArray[i], aAllowDuplicates);
	  }
	  return set;
	};

	/**
	 * Return how many unique items are in this ArraySet. If duplicates have been
	 * added, than those do not count towards the size.
	 *
	 * @returns Number
	 */
	ArraySet.prototype.size = function ArraySet_size() {
	  return Object.getOwnPropertyNames(this._set).length;
	};

	/**
	 * Add the given string to this set.
	 *
	 * @param String aStr
	 */
	ArraySet.prototype.add = function ArraySet_add(aStr, aAllowDuplicates) {
	  var sStr = util.toSetString(aStr);
	  var isDuplicate = has.call(this._set, sStr);
	  var idx = this._array.length;
	  if (!isDuplicate || aAllowDuplicates) {
	    this._array.push(aStr);
	  }
	  if (!isDuplicate) {
	    this._set[sStr] = idx;
	  }
	};

	/**
	 * Is the given string a member of this set?
	 *
	 * @param String aStr
	 */
	ArraySet.prototype.has = function ArraySet_has(aStr) {
	  var sStr = util.toSetString(aStr);
	  return has.call(this._set, sStr);
	};

	/**
	 * What is the index of the given string in the array?
	 *
	 * @param String aStr
	 */
	ArraySet.prototype.indexOf = function ArraySet_indexOf(aStr) {
	  var sStr = util.toSetString(aStr);
	  if (has.call(this._set, sStr)) {
	    return this._set[sStr];
	  }
	  throw new Error('"' + aStr + '" is not in the set.');
	};

	/**
	 * What is the element at the given index?
	 *
	 * @param Number aIdx
	 */
	ArraySet.prototype.at = function ArraySet_at(aIdx) {
	  if (aIdx >= 0 && aIdx < this._array.length) {
	    return this._array[aIdx];
	  }
	  throw new Error('No element indexed by ' + aIdx);
	};

	/**
	 * Returns the array representation of this set (which has the proper indices
	 * indicated by indexOf). Note that this is a copy of the internal array used
	 * for storing the members so that no one can mess with internal state.
	 */
	ArraySet.prototype.toArray = function ArraySet_toArray() {
	  return this._array.slice();
	};

	arraySet.ArraySet = ArraySet;
	return arraySet;
}

var base64Vlq = {};

var base64 = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

var hasRequiredBase64;

function requireBase64 () {
	if (hasRequiredBase64) return base64;
	hasRequiredBase64 = 1;
	/*
	 * Copyright 2011 Mozilla Foundation and contributors
	 * Licensed under the New BSD license. See LICENSE or:
	 * http://opensource.org/licenses/BSD-3-Clause
	 */

	var intToCharMap = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('');

	/**
	 * Encode an integer in the range of 0 to 63 to a single base 64 digit.
	 */
	base64.encode = function (number) {
	  if (0 <= number && number < intToCharMap.length) {
	    return intToCharMap[number];
	  }
	  throw new TypeError("Must be between 0 and 63: " + number);
	};

	/**
	 * Decode a single base 64 character code digit to an integer. Returns -1 on
	 * failure.
	 */
	base64.decode = function (charCode) {
	  var bigA = 65;     // 'A'
	  var bigZ = 90;     // 'Z'

	  var littleA = 97;  // 'a'
	  var littleZ = 122; // 'z'

	  var zero = 48;     // '0'
	  var nine = 57;     // '9'

	  var plus = 43;     // '+'
	  var slash = 47;    // '/'

	  var littleOffset = 26;
	  var numberOffset = 52;

	  // 0 - 25: ABCDEFGHIJKLMNOPQRSTUVWXYZ
	  if (bigA <= charCode && charCode <= bigZ) {
	    return (charCode - bigA);
	  }

	  // 26 - 51: abcdefghijklmnopqrstuvwxyz
	  if (littleA <= charCode && charCode <= littleZ) {
	    return (charCode - littleA + littleOffset);
	  }

	  // 52 - 61: 0123456789
	  if (zero <= charCode && charCode <= nine) {
	    return (charCode - zero + numberOffset);
	  }

	  // 62: +
	  if (charCode == plus) {
	    return 62;
	  }

	  // 63: /
	  if (charCode == slash) {
	    return 63;
	  }

	  // Invalid base64 digit.
	  return -1;
	};
	return base64;
}

/* -*- Mode: js; js-indent-level: 2; -*- */

var hasRequiredBase64Vlq;

function requireBase64Vlq () {
	if (hasRequiredBase64Vlq) return base64Vlq;
	hasRequiredBase64Vlq = 1;
	/*
	 * Copyright 2011 Mozilla Foundation and contributors
	 * Licensed under the New BSD license. See LICENSE or:
	 * http://opensource.org/licenses/BSD-3-Clause
	 *
	 * Based on the Base 64 VLQ implementation in Closure Compiler:
	 * https://code.google.com/p/closure-compiler/source/browse/trunk/src/com/google/debugging/sourcemap/Base64VLQ.java
	 *
	 * Copyright 2011 The Closure Compiler Authors. All rights reserved.
	 * Redistribution and use in source and binary forms, with or without
	 * modification, are permitted provided that the following conditions are
	 * met:
	 *
	 *  * Redistributions of source code must retain the above copyright
	 *    notice, this list of conditions and the following disclaimer.
	 *  * Redistributions in binary form must reproduce the above
	 *    copyright notice, this list of conditions and the following
	 *    disclaimer in the documentation and/or other materials provided
	 *    with the distribution.
	 *  * Neither the name of Google Inc. nor the names of its
	 *    contributors may be used to endorse or promote products derived
	 *    from this software without specific prior written permission.
	 *
	 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
	 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
	 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
	 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
	 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
	 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
	 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
	 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
	 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
	 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
	 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	 */

	var base64 = requireBase64();

	// A single base 64 digit can contain 6 bits of data. For the base 64 variable
	// length quantities we use in the source map spec, the first bit is the sign,
	// the next four bits are the actual value, and the 6th bit is the
	// continuation bit. The continuation bit tells us whether there are more
	// digits in this value following this digit.
	//
	//   Continuation
	//   |    Sign
	//   |    |
	//   V    V
	//   101011

	var VLQ_BASE_SHIFT = 5;

	// binary: 100000
	var VLQ_BASE = 1 << VLQ_BASE_SHIFT;

	// binary: 011111
	var VLQ_BASE_MASK = VLQ_BASE - 1;

	// binary: 100000
	var VLQ_CONTINUATION_BIT = VLQ_BASE;

	/**
	 * Converts from a two-complement value to a value where the sign bit is
	 * placed in the least significant bit.  For example, as decimals:
	 *   1 becomes 2 (10 binary), -1 becomes 3 (11 binary)
	 *   2 becomes 4 (100 binary), -2 becomes 5 (101 binary)
	 */
	function toVLQSigned(aValue) {
	  return aValue < 0
	    ? ((-aValue) << 1) + 1
	    : (aValue << 1) + 0;
	}

	/**
	 * Converts to a two-complement value from a value where the sign bit is
	 * placed in the least significant bit.  For example, as decimals:
	 *   2 (10 binary) becomes 1, 3 (11 binary) becomes -1
	 *   4 (100 binary) becomes 2, 5 (101 binary) becomes -2
	 */
	function fromVLQSigned(aValue) {
	  var isNegative = (aValue & 1) === 1;
	  var shifted = aValue >> 1;
	  return isNegative
	    ? -shifted
	    : shifted;
	}

	/**
	 * Returns the base 64 VLQ encoded value.
	 */
	base64Vlq.encode = function base64VLQ_encode(aValue) {
	  var encoded = "";
	  var digit;

	  var vlq = toVLQSigned(aValue);

	  do {
	    digit = vlq & VLQ_BASE_MASK;
	    vlq >>>= VLQ_BASE_SHIFT;
	    if (vlq > 0) {
	      // There are still more digits in this value, so we must make sure the
	      // continuation bit is marked.
	      digit |= VLQ_CONTINUATION_BIT;
	    }
	    encoded += base64.encode(digit);
	  } while (vlq > 0);

	  return encoded;
	};

	/**
	 * Decodes the next base 64 VLQ value from the given string and returns the
	 * value and the rest of the string via the out parameter.
	 */
	base64Vlq.decode = function base64VLQ_decode(aStr, aIndex, aOutParam) {
	  var strLen = aStr.length;
	  var result = 0;
	  var shift = 0;
	  var continuation, digit;

	  do {
	    if (aIndex >= strLen) {
	      throw new Error("Expected more digits in base 64 VLQ value.");
	    }

	    digit = base64.decode(aStr.charCodeAt(aIndex++));
	    if (digit === -1) {
	      throw new Error("Invalid base64 digit: " + aStr.charAt(aIndex - 1));
	    }

	    continuation = !!(digit & VLQ_CONTINUATION_BIT);
	    digit &= VLQ_BASE_MASK;
	    result = result + (digit << shift);
	    shift += VLQ_BASE_SHIFT;
	  } while (continuation);

	  aOutParam.value = fromVLQSigned(result);
	  aOutParam.rest = aIndex;
	};
	return base64Vlq;
}

var quickSort = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

var hasRequiredQuickSort;

function requireQuickSort () {
	if (hasRequiredQuickSort) return quickSort;
	hasRequiredQuickSort = 1;
	/*
	 * Copyright 2011 Mozilla Foundation and contributors
	 * Licensed under the New BSD license. See LICENSE or:
	 * http://opensource.org/licenses/BSD-3-Clause
	 */

	// It turns out that some (most?) JavaScript engines don't self-host
	// `Array.prototype.sort`. This makes sense because C++ will likely remain
	// faster than JS when doing raw CPU-intensive sorting. However, when using a
	// custom comparator function, calling back and forth between the VM's C++ and
	// JIT'd JS is rather slow *and* loses JIT type information, resulting in
	// worse generated code for the comparator function than would be optimal. In
	// fact, when sorting with a comparator, these costs outweigh the benefits of
	// sorting in C++. By using our own JS-implemented Quick Sort (below), we get
	// a ~3500ms mean speed-up in `bench/bench.html`.

	/**
	 * Swap the elements indexed by `x` and `y` in the array `ary`.
	 *
	 * @param {Array} ary
	 *        The array.
	 * @param {Number} x
	 *        The index of the first item.
	 * @param {Number} y
	 *        The index of the second item.
	 */
	function swap(ary, x, y) {
	  var temp = ary[x];
	  ary[x] = ary[y];
	  ary[y] = temp;
	}

	/**
	 * Returns a random integer within the range `low .. high` inclusive.
	 *
	 * @param {Number} low
	 *        The lower bound on the range.
	 * @param {Number} high
	 *        The upper bound on the range.
	 */
	function randomIntInRange(low, high) {
	  return Math.round(low + (Math.random() * (high - low)));
	}

	/**
	 * The Quick Sort algorithm.
	 *
	 * @param {Array} ary
	 *        An array to sort.
	 * @param {function} comparator
	 *        Function to use to compare two items.
	 * @param {Number} p
	 *        Start index of the array
	 * @param {Number} r
	 *        End index of the array
	 */
	function doQuickSort(ary, comparator, p, r) {
	  // If our lower bound is less than our upper bound, we (1) partition the
	  // array into two pieces and (2) recurse on each half. If it is not, this is
	  // the empty array and our base case.

	  if (p < r) {
	    // (1) Partitioning.
	    //
	    // The partitioning chooses a pivot between `p` and `r` and moves all
	    // elements that are less than or equal to the pivot to the before it, and
	    // all the elements that are greater than it after it. The effect is that
	    // once partition is done, the pivot is in the exact place it will be when
	    // the array is put in sorted order, and it will not need to be moved
	    // again. This runs in O(n) time.

	    // Always choose a random pivot so that an input array which is reverse
	    // sorted does not cause O(n^2) running time.
	    var pivotIndex = randomIntInRange(p, r);
	    var i = p - 1;

	    swap(ary, pivotIndex, r);
	    var pivot = ary[r];

	    // Immediately after `j` is incremented in this loop, the following hold
	    // true:
	    //
	    //   * Every element in `ary[p .. i]` is less than or equal to the pivot.
	    //
	    //   * Every element in `ary[i+1 .. j-1]` is greater than the pivot.
	    for (var j = p; j < r; j++) {
	      if (comparator(ary[j], pivot) <= 0) {
	        i += 1;
	        swap(ary, i, j);
	      }
	    }

	    swap(ary, i + 1, j);
	    var q = i + 1;

	    // (2) Recurse on each half.

	    doQuickSort(ary, comparator, p, q - 1);
	    doQuickSort(ary, comparator, q + 1, r);
	  }
	}

	/**
	 * Sort the given array in-place with the given comparator function.
	 *
	 * @param {Array} ary
	 *        An array to sort.
	 * @param {function} comparator
	 *        Function to use to compare two items.
	 */
	quickSort.quickSort = function (ary, comparator) {
	  doQuickSort(ary, comparator, 0, ary.length - 1);
	};
	return quickSort;
}

/* -*- Mode: js; js-indent-level: 2; -*- */

var hasRequiredSourceMapConsumer;

function requireSourceMapConsumer () {
	if (hasRequiredSourceMapConsumer) return sourceMapConsumer;
	hasRequiredSourceMapConsumer = 1;
	/*
	 * Copyright 2011 Mozilla Foundation and contributors
	 * Licensed under the New BSD license. See LICENSE or:
	 * http://opensource.org/licenses/BSD-3-Clause
	 */

	var util = requireUtil();
	var binarySearch = requireBinarySearch();
	var ArraySet = requireArraySet().ArraySet;
	var base64VLQ = requireBase64Vlq();
	var quickSort = requireQuickSort().quickSort;

	function SourceMapConsumer(aSourceMap) {
	  var sourceMap = aSourceMap;
	  if (typeof aSourceMap === 'string') {
	    sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
	  }

	  return sourceMap.sections != null
	    ? new IndexedSourceMapConsumer(sourceMap)
	    : new BasicSourceMapConsumer(sourceMap);
	}

	SourceMapConsumer.fromSourceMap = function(aSourceMap) {
	  return BasicSourceMapConsumer.fromSourceMap(aSourceMap);
	};

	/**
	 * The version of the source mapping spec that we are consuming.
	 */
	SourceMapConsumer.prototype._version = 3;

	// `__generatedMappings` and `__originalMappings` are arrays that hold the
	// parsed mapping coordinates from the source map's "mappings" attribute. They
	// are lazily instantiated, accessed via the `_generatedMappings` and
	// `_originalMappings` getters respectively, and we only parse the mappings
	// and create these arrays once queried for a source location. We jump through
	// these hoops because there can be many thousands of mappings, and parsing
	// them is expensive, so we only want to do it if we must.
	//
	// Each object in the arrays is of the form:
	//
	//     {
	//       generatedLine: The line number in the generated code,
	//       generatedColumn: The column number in the generated code,
	//       source: The path to the original source file that generated this
	//               chunk of code,
	//       originalLine: The line number in the original source that
	//                     corresponds to this chunk of generated code,
	//       originalColumn: The column number in the original source that
	//                       corresponds to this chunk of generated code,
	//       name: The name of the original symbol which generated this chunk of
	//             code.
	//     }
	//
	// All properties except for `generatedLine` and `generatedColumn` can be
	// `null`.
	//
	// `_generatedMappings` is ordered by the generated positions.
	//
	// `_originalMappings` is ordered by the original positions.

	SourceMapConsumer.prototype.__generatedMappings = null;
	Object.defineProperty(SourceMapConsumer.prototype, '_generatedMappings', {
	  get: function () {
	    if (!this.__generatedMappings) {
	      this._parseMappings(this._mappings, this.sourceRoot);
	    }

	    return this.__generatedMappings;
	  }
	});

	SourceMapConsumer.prototype.__originalMappings = null;
	Object.defineProperty(SourceMapConsumer.prototype, '_originalMappings', {
	  get: function () {
	    if (!this.__originalMappings) {
	      this._parseMappings(this._mappings, this.sourceRoot);
	    }

	    return this.__originalMappings;
	  }
	});

	SourceMapConsumer.prototype._charIsMappingSeparator =
	  function SourceMapConsumer_charIsMappingSeparator(aStr, index) {
	    var c = aStr.charAt(index);
	    return c === ";" || c === ",";
	  };

	/**
	 * Parse the mappings in a string in to a data structure which we can easily
	 * query (the ordered arrays in the `this.__generatedMappings` and
	 * `this.__originalMappings` properties).
	 */
	SourceMapConsumer.prototype._parseMappings =
	  function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
	    throw new Error("Subclasses must implement _parseMappings");
	  };

	SourceMapConsumer.GENERATED_ORDER = 1;
	SourceMapConsumer.ORIGINAL_ORDER = 2;

	SourceMapConsumer.GREATEST_LOWER_BOUND = 1;
	SourceMapConsumer.LEAST_UPPER_BOUND = 2;

	/**
	 * Iterate over each mapping between an original source/line/column and a
	 * generated line/column in this source map.
	 *
	 * @param Function aCallback
	 *        The function that is called with each mapping.
	 * @param Object aContext
	 *        Optional. If specified, this object will be the value of `this` every
	 *        time that `aCallback` is called.
	 * @param aOrder
	 *        Either `SourceMapConsumer.GENERATED_ORDER` or
	 *        `SourceMapConsumer.ORIGINAL_ORDER`. Specifies whether you want to
	 *        iterate over the mappings sorted by the generated file's line/column
	 *        order or the original's source/line/column order, respectively. Defaults to
	 *        `SourceMapConsumer.GENERATED_ORDER`.
	 */
	SourceMapConsumer.prototype.eachMapping =
	  function SourceMapConsumer_eachMapping(aCallback, aContext, aOrder) {
	    var context = aContext || null;
	    var order = aOrder || SourceMapConsumer.GENERATED_ORDER;

	    var mappings;
	    switch (order) {
	    case SourceMapConsumer.GENERATED_ORDER:
	      mappings = this._generatedMappings;
	      break;
	    case SourceMapConsumer.ORIGINAL_ORDER:
	      mappings = this._originalMappings;
	      break;
	    default:
	      throw new Error("Unknown order of iteration.");
	    }

	    var sourceRoot = this.sourceRoot;
	    mappings.map(function (mapping) {
	      var source = mapping.source === null ? null : this._sources.at(mapping.source);
	      if (source != null && sourceRoot != null) {
	        source = util.join(sourceRoot, source);
	      }
	      return {
	        source: source,
	        generatedLine: mapping.generatedLine,
	        generatedColumn: mapping.generatedColumn,
	        originalLine: mapping.originalLine,
	        originalColumn: mapping.originalColumn,
	        name: mapping.name === null ? null : this._names.at(mapping.name)
	      };
	    }, this).forEach(aCallback, context);
	  };

	/**
	 * Returns all generated line and column information for the original source,
	 * line, and column provided. If no column is provided, returns all mappings
	 * corresponding to a either the line we are searching for or the next
	 * closest line that has any mappings. Otherwise, returns all mappings
	 * corresponding to the given line and either the column we are searching for
	 * or the next closest column that has any offsets.
	 *
	 * The only argument is an object with the following properties:
	 *
	 *   - source: The filename of the original source.
	 *   - line: The line number in the original source.
	 *   - column: Optional. the column number in the original source.
	 *
	 * and an array of objects is returned, each with the following properties:
	 *
	 *   - line: The line number in the generated source, or null.
	 *   - column: The column number in the generated source, or null.
	 */
	SourceMapConsumer.prototype.allGeneratedPositionsFor =
	  function SourceMapConsumer_allGeneratedPositionsFor(aArgs) {
	    var line = util.getArg(aArgs, 'line');

	    // When there is no exact match, BasicSourceMapConsumer.prototype._findMapping
	    // returns the index of the closest mapping less than the needle. By
	    // setting needle.originalColumn to 0, we thus find the last mapping for
	    // the given line, provided such a mapping exists.
	    var needle = {
	      source: util.getArg(aArgs, 'source'),
	      originalLine: line,
	      originalColumn: util.getArg(aArgs, 'column', 0)
	    };

	    if (this.sourceRoot != null) {
	      needle.source = util.relative(this.sourceRoot, needle.source);
	    }
	    if (!this._sources.has(needle.source)) {
	      return [];
	    }
	    needle.source = this._sources.indexOf(needle.source);

	    var mappings = [];

	    var index = this._findMapping(needle,
	                                  this._originalMappings,
	                                  "originalLine",
	                                  "originalColumn",
	                                  util.compareByOriginalPositions,
	                                  binarySearch.LEAST_UPPER_BOUND);
	    if (index >= 0) {
	      var mapping = this._originalMappings[index];

	      if (aArgs.column === undefined) {
	        var originalLine = mapping.originalLine;

	        // Iterate until either we run out of mappings, or we run into
	        // a mapping for a different line than the one we found. Since
	        // mappings are sorted, this is guaranteed to find all mappings for
	        // the line we found.
	        while (mapping && mapping.originalLine === originalLine) {
	          mappings.push({
	            line: util.getArg(mapping, 'generatedLine', null),
	            column: util.getArg(mapping, 'generatedColumn', null),
	            lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
	          });

	          mapping = this._originalMappings[++index];
	        }
	      } else {
	        var originalColumn = mapping.originalColumn;

	        // Iterate until either we run out of mappings, or we run into
	        // a mapping for a different line than the one we were searching for.
	        // Since mappings are sorted, this is guaranteed to find all mappings for
	        // the line we are searching for.
	        while (mapping &&
	               mapping.originalLine === line &&
	               mapping.originalColumn == originalColumn) {
	          mappings.push({
	            line: util.getArg(mapping, 'generatedLine', null),
	            column: util.getArg(mapping, 'generatedColumn', null),
	            lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
	          });

	          mapping = this._originalMappings[++index];
	        }
	      }
	    }

	    return mappings;
	  };

	sourceMapConsumer.SourceMapConsumer = SourceMapConsumer;

	/**
	 * A BasicSourceMapConsumer instance represents a parsed source map which we can
	 * query for information about the original file positions by giving it a file
	 * position in the generated source.
	 *
	 * The only parameter is the raw source map (either as a JSON string, or
	 * already parsed to an object). According to the spec, source maps have the
	 * following attributes:
	 *
	 *   - version: Which version of the source map spec this map is following.
	 *   - sources: An array of URLs to the original source files.
	 *   - names: An array of identifiers which can be referrenced by individual mappings.
	 *   - sourceRoot: Optional. The URL root from which all sources are relative.
	 *   - sourcesContent: Optional. An array of contents of the original source files.
	 *   - mappings: A string of base64 VLQs which contain the actual mappings.
	 *   - file: Optional. The generated file this source map is associated with.
	 *
	 * Here is an example source map, taken from the source map spec[0]:
	 *
	 *     {
	 *       version : 3,
	 *       file: "out.js",
	 *       sourceRoot : "",
	 *       sources: ["foo.js", "bar.js"],
	 *       names: ["src", "maps", "are", "fun"],
	 *       mappings: "AA,AB;;ABCDE;"
	 *     }
	 *
	 * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit?pli=1#
	 */
	function BasicSourceMapConsumer(aSourceMap) {
	  var sourceMap = aSourceMap;
	  if (typeof aSourceMap === 'string') {
	    sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
	  }

	  var version = util.getArg(sourceMap, 'version');
	  var sources = util.getArg(sourceMap, 'sources');
	  // Sass 3.3 leaves out the 'names' array, so we deviate from the spec (which
	  // requires the array) to play nice here.
	  var names = util.getArg(sourceMap, 'names', []);
	  var sourceRoot = util.getArg(sourceMap, 'sourceRoot', null);
	  var sourcesContent = util.getArg(sourceMap, 'sourcesContent', null);
	  var mappings = util.getArg(sourceMap, 'mappings');
	  var file = util.getArg(sourceMap, 'file', null);

	  // Once again, Sass deviates from the spec and supplies the version as a
	  // string rather than a number, so we use loose equality checking here.
	  if (version != this._version) {
	    throw new Error('Unsupported version: ' + version);
	  }

	  sources = sources
	    .map(String)
	    // Some source maps produce relative source paths like "./foo.js" instead of
	    // "foo.js".  Normalize these first so that future comparisons will succeed.
	    // See bugzil.la/1090768.
	    .map(util.normalize)
	    // Always ensure that absolute sources are internally stored relative to
	    // the source root, if the source root is absolute. Not doing this would
	    // be particularly problematic when the source root is a prefix of the
	    // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
	    .map(function (source) {
	      return sourceRoot && util.isAbsolute(sourceRoot) && util.isAbsolute(source)
	        ? util.relative(sourceRoot, source)
	        : source;
	    });

	  // Pass `true` below to allow duplicate names and sources. While source maps
	  // are intended to be compressed and deduplicated, the TypeScript compiler
	  // sometimes generates source maps with duplicates in them. See Github issue
	  // #72 and bugzil.la/889492.
	  this._names = ArraySet.fromArray(names.map(String), true);
	  this._sources = ArraySet.fromArray(sources, true);

	  this.sourceRoot = sourceRoot;
	  this.sourcesContent = sourcesContent;
	  this._mappings = mappings;
	  this.file = file;
	}

	BasicSourceMapConsumer.prototype = Object.create(SourceMapConsumer.prototype);
	BasicSourceMapConsumer.prototype.consumer = SourceMapConsumer;

	/**
	 * Create a BasicSourceMapConsumer from a SourceMapGenerator.
	 *
	 * @param SourceMapGenerator aSourceMap
	 *        The source map that will be consumed.
	 * @returns BasicSourceMapConsumer
	 */
	BasicSourceMapConsumer.fromSourceMap =
	  function SourceMapConsumer_fromSourceMap(aSourceMap) {
	    var smc = Object.create(BasicSourceMapConsumer.prototype);

	    var names = smc._names = ArraySet.fromArray(aSourceMap._names.toArray(), true);
	    var sources = smc._sources = ArraySet.fromArray(aSourceMap._sources.toArray(), true);
	    smc.sourceRoot = aSourceMap._sourceRoot;
	    smc.sourcesContent = aSourceMap._generateSourcesContent(smc._sources.toArray(),
	                                                            smc.sourceRoot);
	    smc.file = aSourceMap._file;

	    // Because we are modifying the entries (by converting string sources and
	    // names to indices into the sources and names ArraySets), we have to make
	    // a copy of the entry or else bad things happen. Shared mutable state
	    // strikes again! See github issue #191.

	    var generatedMappings = aSourceMap._mappings.toArray().slice();
	    var destGeneratedMappings = smc.__generatedMappings = [];
	    var destOriginalMappings = smc.__originalMappings = [];

	    for (var i = 0, length = generatedMappings.length; i < length; i++) {
	      var srcMapping = generatedMappings[i];
	      var destMapping = new Mapping;
	      destMapping.generatedLine = srcMapping.generatedLine;
	      destMapping.generatedColumn = srcMapping.generatedColumn;

	      if (srcMapping.source) {
	        destMapping.source = sources.indexOf(srcMapping.source);
	        destMapping.originalLine = srcMapping.originalLine;
	        destMapping.originalColumn = srcMapping.originalColumn;

	        if (srcMapping.name) {
	          destMapping.name = names.indexOf(srcMapping.name);
	        }

	        destOriginalMappings.push(destMapping);
	      }

	      destGeneratedMappings.push(destMapping);
	    }

	    quickSort(smc.__originalMappings, util.compareByOriginalPositions);

	    return smc;
	  };

	/**
	 * The version of the source mapping spec that we are consuming.
	 */
	BasicSourceMapConsumer.prototype._version = 3;

	/**
	 * The list of original sources.
	 */
	Object.defineProperty(BasicSourceMapConsumer.prototype, 'sources', {
	  get: function () {
	    return this._sources.toArray().map(function (s) {
	      return this.sourceRoot != null ? util.join(this.sourceRoot, s) : s;
	    }, this);
	  }
	});

	/**
	 * Provide the JIT with a nice shape / hidden class.
	 */
	function Mapping() {
	  this.generatedLine = 0;
	  this.generatedColumn = 0;
	  this.source = null;
	  this.originalLine = null;
	  this.originalColumn = null;
	  this.name = null;
	}

	/**
	 * Parse the mappings in a string in to a data structure which we can easily
	 * query (the ordered arrays in the `this.__generatedMappings` and
	 * `this.__originalMappings` properties).
	 */
	BasicSourceMapConsumer.prototype._parseMappings =
	  function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
	    var generatedLine = 1;
	    var previousGeneratedColumn = 0;
	    var previousOriginalLine = 0;
	    var previousOriginalColumn = 0;
	    var previousSource = 0;
	    var previousName = 0;
	    var length = aStr.length;
	    var index = 0;
	    var cachedSegments = {};
	    var temp = {};
	    var originalMappings = [];
	    var generatedMappings = [];
	    var mapping, str, segment, end, value;

	    while (index < length) {
	      if (aStr.charAt(index) === ';') {
	        generatedLine++;
	        index++;
	        previousGeneratedColumn = 0;
	      }
	      else if (aStr.charAt(index) === ',') {
	        index++;
	      }
	      else {
	        mapping = new Mapping();
	        mapping.generatedLine = generatedLine;

	        // Because each offset is encoded relative to the previous one,
	        // many segments often have the same encoding. We can exploit this
	        // fact by caching the parsed variable length fields of each segment,
	        // allowing us to avoid a second parse if we encounter the same
	        // segment again.
	        for (end = index; end < length; end++) {
	          if (this._charIsMappingSeparator(aStr, end)) {
	            break;
	          }
	        }
	        str = aStr.slice(index, end);

	        segment = cachedSegments[str];
	        if (segment) {
	          index += str.length;
	        } else {
	          segment = [];
	          while (index < end) {
	            base64VLQ.decode(aStr, index, temp);
	            value = temp.value;
	            index = temp.rest;
	            segment.push(value);
	          }

	          if (segment.length === 2) {
	            throw new Error('Found a source, but no line and column');
	          }

	          if (segment.length === 3) {
	            throw new Error('Found a source and line, but no column');
	          }

	          cachedSegments[str] = segment;
	        }

	        // Generated column.
	        mapping.generatedColumn = previousGeneratedColumn + segment[0];
	        previousGeneratedColumn = mapping.generatedColumn;

	        if (segment.length > 1) {
	          // Original source.
	          mapping.source = previousSource + segment[1];
	          previousSource += segment[1];

	          // Original line.
	          mapping.originalLine = previousOriginalLine + segment[2];
	          previousOriginalLine = mapping.originalLine;
	          // Lines are stored 0-based
	          mapping.originalLine += 1;

	          // Original column.
	          mapping.originalColumn = previousOriginalColumn + segment[3];
	          previousOriginalColumn = mapping.originalColumn;

	          if (segment.length > 4) {
	            // Original name.
	            mapping.name = previousName + segment[4];
	            previousName += segment[4];
	          }
	        }

	        generatedMappings.push(mapping);
	        if (typeof mapping.originalLine === 'number') {
	          originalMappings.push(mapping);
	        }
	      }
	    }

	    quickSort(generatedMappings, util.compareByGeneratedPositionsDeflated);
	    this.__generatedMappings = generatedMappings;

	    quickSort(originalMappings, util.compareByOriginalPositions);
	    this.__originalMappings = originalMappings;
	  };

	/**
	 * Find the mapping that best matches the hypothetical "needle" mapping that
	 * we are searching for in the given "haystack" of mappings.
	 */
	BasicSourceMapConsumer.prototype._findMapping =
	  function SourceMapConsumer_findMapping(aNeedle, aMappings, aLineName,
	                                         aColumnName, aComparator, aBias) {
	    // To return the position we are searching for, we must first find the
	    // mapping for the given position and then return the opposite position it
	    // points to. Because the mappings are sorted, we can use binary search to
	    // find the best mapping.

	    if (aNeedle[aLineName] <= 0) {
	      throw new TypeError('Line must be greater than or equal to 1, got '
	                          + aNeedle[aLineName]);
	    }
	    if (aNeedle[aColumnName] < 0) {
	      throw new TypeError('Column must be greater than or equal to 0, got '
	                          + aNeedle[aColumnName]);
	    }

	    return binarySearch.search(aNeedle, aMappings, aComparator, aBias);
	  };

	/**
	 * Compute the last column for each generated mapping. The last column is
	 * inclusive.
	 */
	BasicSourceMapConsumer.prototype.computeColumnSpans =
	  function SourceMapConsumer_computeColumnSpans() {
	    for (var index = 0; index < this._generatedMappings.length; ++index) {
	      var mapping = this._generatedMappings[index];

	      // Mappings do not contain a field for the last generated columnt. We
	      // can come up with an optimistic estimate, however, by assuming that
	      // mappings are contiguous (i.e. given two consecutive mappings, the
	      // first mapping ends where the second one starts).
	      if (index + 1 < this._generatedMappings.length) {
	        var nextMapping = this._generatedMappings[index + 1];

	        if (mapping.generatedLine === nextMapping.generatedLine) {
	          mapping.lastGeneratedColumn = nextMapping.generatedColumn - 1;
	          continue;
	        }
	      }

	      // The last mapping for each line spans the entire line.
	      mapping.lastGeneratedColumn = Infinity;
	    }
	  };

	/**
	 * Returns the original source, line, and column information for the generated
	 * source's line and column positions provided. The only argument is an object
	 * with the following properties:
	 *
	 *   - line: The line number in the generated source.
	 *   - column: The column number in the generated source.
	 *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
	 *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
	 *     closest element that is smaller than or greater than the one we are
	 *     searching for, respectively, if the exact element cannot be found.
	 *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
	 *
	 * and an object is returned with the following properties:
	 *
	 *   - source: The original source file, or null.
	 *   - line: The line number in the original source, or null.
	 *   - column: The column number in the original source, or null.
	 *   - name: The original identifier, or null.
	 */
	BasicSourceMapConsumer.prototype.originalPositionFor =
	  function SourceMapConsumer_originalPositionFor(aArgs) {
	    var needle = {
	      generatedLine: util.getArg(aArgs, 'line'),
	      generatedColumn: util.getArg(aArgs, 'column')
	    };

	    var index = this._findMapping(
	      needle,
	      this._generatedMappings,
	      "generatedLine",
	      "generatedColumn",
	      util.compareByGeneratedPositionsDeflated,
	      util.getArg(aArgs, 'bias', SourceMapConsumer.GREATEST_LOWER_BOUND)
	    );

	    if (index >= 0) {
	      var mapping = this._generatedMappings[index];

	      if (mapping.generatedLine === needle.generatedLine) {
	        var source = util.getArg(mapping, 'source', null);
	        if (source !== null) {
	          source = this._sources.at(source);
	          if (this.sourceRoot != null) {
	            source = util.join(this.sourceRoot, source);
	          }
	        }
	        var name = util.getArg(mapping, 'name', null);
	        if (name !== null) {
	          name = this._names.at(name);
	        }
	        return {
	          source: source,
	          line: util.getArg(mapping, 'originalLine', null),
	          column: util.getArg(mapping, 'originalColumn', null),
	          name: name
	        };
	      }
	    }

	    return {
	      source: null,
	      line: null,
	      column: null,
	      name: null
	    };
	  };

	/**
	 * Return true if we have the source content for every source in the source
	 * map, false otherwise.
	 */
	BasicSourceMapConsumer.prototype.hasContentsOfAllSources =
	  function BasicSourceMapConsumer_hasContentsOfAllSources() {
	    if (!this.sourcesContent) {
	      return false;
	    }
	    return this.sourcesContent.length >= this._sources.size() &&
	      !this.sourcesContent.some(function (sc) { return sc == null; });
	  };

	/**
	 * Returns the original source content. The only argument is the url of the
	 * original source file. Returns null if no original source content is
	 * available.
	 */
	BasicSourceMapConsumer.prototype.sourceContentFor =
	  function SourceMapConsumer_sourceContentFor(aSource, nullOnMissing) {
	    if (!this.sourcesContent) {
	      return null;
	    }

	    if (this.sourceRoot != null) {
	      aSource = util.relative(this.sourceRoot, aSource);
	    }

	    if (this._sources.has(aSource)) {
	      return this.sourcesContent[this._sources.indexOf(aSource)];
	    }

	    var url;
	    if (this.sourceRoot != null
	        && (url = util.urlParse(this.sourceRoot))) {
	      // XXX: file:// URIs and absolute paths lead to unexpected behavior for
	      // many users. We can help them out when they expect file:// URIs to
	      // behave like it would if they were running a local HTTP server. See
	      // https://bugzilla.mozilla.org/show_bug.cgi?id=885597.
	      var fileUriAbsPath = aSource.replace(/^file:\/\//, "");
	      if (url.scheme == "file"
	          && this._sources.has(fileUriAbsPath)) {
	        return this.sourcesContent[this._sources.indexOf(fileUriAbsPath)]
	      }

	      if ((!url.path || url.path == "/")
	          && this._sources.has("/" + aSource)) {
	        return this.sourcesContent[this._sources.indexOf("/" + aSource)];
	      }
	    }

	    // This function is used recursively from
	    // IndexedSourceMapConsumer.prototype.sourceContentFor. In that case, we
	    // don't want to throw if we can't find the source - we just want to
	    // return null, so we provide a flag to exit gracefully.
	    if (nullOnMissing) {
	      return null;
	    }
	    else {
	      throw new Error('"' + aSource + '" is not in the SourceMap.');
	    }
	  };

	/**
	 * Returns the generated line and column information for the original source,
	 * line, and column positions provided. The only argument is an object with
	 * the following properties:
	 *
	 *   - source: The filename of the original source.
	 *   - line: The line number in the original source.
	 *   - column: The column number in the original source.
	 *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
	 *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
	 *     closest element that is smaller than or greater than the one we are
	 *     searching for, respectively, if the exact element cannot be found.
	 *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
	 *
	 * and an object is returned with the following properties:
	 *
	 *   - line: The line number in the generated source, or null.
	 *   - column: The column number in the generated source, or null.
	 */
	BasicSourceMapConsumer.prototype.generatedPositionFor =
	  function SourceMapConsumer_generatedPositionFor(aArgs) {
	    var source = util.getArg(aArgs, 'source');
	    if (this.sourceRoot != null) {
	      source = util.relative(this.sourceRoot, source);
	    }
	    if (!this._sources.has(source)) {
	      return {
	        line: null,
	        column: null,
	        lastColumn: null
	      };
	    }
	    source = this._sources.indexOf(source);

	    var needle = {
	      source: source,
	      originalLine: util.getArg(aArgs, 'line'),
	      originalColumn: util.getArg(aArgs, 'column')
	    };

	    var index = this._findMapping(
	      needle,
	      this._originalMappings,
	      "originalLine",
	      "originalColumn",
	      util.compareByOriginalPositions,
	      util.getArg(aArgs, 'bias', SourceMapConsumer.GREATEST_LOWER_BOUND)
	    );

	    if (index >= 0) {
	      var mapping = this._originalMappings[index];

	      if (mapping.source === needle.source) {
	        return {
	          line: util.getArg(mapping, 'generatedLine', null),
	          column: util.getArg(mapping, 'generatedColumn', null),
	          lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
	        };
	      }
	    }

	    return {
	      line: null,
	      column: null,
	      lastColumn: null
	    };
	  };

	sourceMapConsumer.BasicSourceMapConsumer = BasicSourceMapConsumer;

	/**
	 * An IndexedSourceMapConsumer instance represents a parsed source map which
	 * we can query for information. It differs from BasicSourceMapConsumer in
	 * that it takes "indexed" source maps (i.e. ones with a "sections" field) as
	 * input.
	 *
	 * The only parameter is a raw source map (either as a JSON string, or already
	 * parsed to an object). According to the spec for indexed source maps, they
	 * have the following attributes:
	 *
	 *   - version: Which version of the source map spec this map is following.
	 *   - file: Optional. The generated file this source map is associated with.
	 *   - sections: A list of section definitions.
	 *
	 * Each value under the "sections" field has two fields:
	 *   - offset: The offset into the original specified at which this section
	 *       begins to apply, defined as an object with a "line" and "column"
	 *       field.
	 *   - map: A source map definition. This source map could also be indexed,
	 *       but doesn't have to be.
	 *
	 * Instead of the "map" field, it's also possible to have a "url" field
	 * specifying a URL to retrieve a source map from, but that's currently
	 * unsupported.
	 *
	 * Here's an example source map, taken from the source map spec[0], but
	 * modified to omit a section which uses the "url" field.
	 *
	 *  {
	 *    version : 3,
	 *    file: "app.js",
	 *    sections: [{
	 *      offset: {line:100, column:10},
	 *      map: {
	 *        version : 3,
	 *        file: "section.js",
	 *        sources: ["foo.js", "bar.js"],
	 *        names: ["src", "maps", "are", "fun"],
	 *        mappings: "AAAA,E;;ABCDE;"
	 *      }
	 *    }],
	 *  }
	 *
	 * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit#heading=h.535es3xeprgt
	 */
	function IndexedSourceMapConsumer(aSourceMap) {
	  var sourceMap = aSourceMap;
	  if (typeof aSourceMap === 'string') {
	    sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
	  }

	  var version = util.getArg(sourceMap, 'version');
	  var sections = util.getArg(sourceMap, 'sections');

	  if (version != this._version) {
	    throw new Error('Unsupported version: ' + version);
	  }

	  this._sources = new ArraySet();
	  this._names = new ArraySet();

	  var lastOffset = {
	    line: -1,
	    column: 0
	  };
	  this._sections = sections.map(function (s) {
	    if (s.url) {
	      // The url field will require support for asynchronicity.
	      // See https://github.com/mozilla/source-map/issues/16
	      throw new Error('Support for url field in sections not implemented.');
	    }
	    var offset = util.getArg(s, 'offset');
	    var offsetLine = util.getArg(offset, 'line');
	    var offsetColumn = util.getArg(offset, 'column');

	    if (offsetLine < lastOffset.line ||
	        (offsetLine === lastOffset.line && offsetColumn < lastOffset.column)) {
	      throw new Error('Section offsets must be ordered and non-overlapping.');
	    }
	    lastOffset = offset;

	    return {
	      generatedOffset: {
	        // The offset fields are 0-based, but we use 1-based indices when
	        // encoding/decoding from VLQ.
	        generatedLine: offsetLine + 1,
	        generatedColumn: offsetColumn + 1
	      },
	      consumer: new SourceMapConsumer(util.getArg(s, 'map'))
	    }
	  });
	}

	IndexedSourceMapConsumer.prototype = Object.create(SourceMapConsumer.prototype);
	IndexedSourceMapConsumer.prototype.constructor = SourceMapConsumer;

	/**
	 * The version of the source mapping spec that we are consuming.
	 */
	IndexedSourceMapConsumer.prototype._version = 3;

	/**
	 * The list of original sources.
	 */
	Object.defineProperty(IndexedSourceMapConsumer.prototype, 'sources', {
	  get: function () {
	    var sources = [];
	    for (var i = 0; i < this._sections.length; i++) {
	      for (var j = 0; j < this._sections[i].consumer.sources.length; j++) {
	        sources.push(this._sections[i].consumer.sources[j]);
	      }
	    }
	    return sources;
	  }
	});

	/**
	 * Returns the original source, line, and column information for the generated
	 * source's line and column positions provided. The only argument is an object
	 * with the following properties:
	 *
	 *   - line: The line number in the generated source.
	 *   - column: The column number in the generated source.
	 *
	 * and an object is returned with the following properties:
	 *
	 *   - source: The original source file, or null.
	 *   - line: The line number in the original source, or null.
	 *   - column: The column number in the original source, or null.
	 *   - name: The original identifier, or null.
	 */
	IndexedSourceMapConsumer.prototype.originalPositionFor =
	  function IndexedSourceMapConsumer_originalPositionFor(aArgs) {
	    var needle = {
	      generatedLine: util.getArg(aArgs, 'line'),
	      generatedColumn: util.getArg(aArgs, 'column')
	    };

	    // Find the section containing the generated position we're trying to map
	    // to an original position.
	    var sectionIndex = binarySearch.search(needle, this._sections,
	      function(needle, section) {
	        var cmp = needle.generatedLine - section.generatedOffset.generatedLine;
	        if (cmp) {
	          return cmp;
	        }

	        return (needle.generatedColumn -
	                section.generatedOffset.generatedColumn);
	      });
	    var section = this._sections[sectionIndex];

	    if (!section) {
	      return {
	        source: null,
	        line: null,
	        column: null,
	        name: null
	      };
	    }

	    return section.consumer.originalPositionFor({
	      line: needle.generatedLine -
	        (section.generatedOffset.generatedLine - 1),
	      column: needle.generatedColumn -
	        (section.generatedOffset.generatedLine === needle.generatedLine
	         ? section.generatedOffset.generatedColumn - 1
	         : 0),
	      bias: aArgs.bias
	    });
	  };

	/**
	 * Return true if we have the source content for every source in the source
	 * map, false otherwise.
	 */
	IndexedSourceMapConsumer.prototype.hasContentsOfAllSources =
	  function IndexedSourceMapConsumer_hasContentsOfAllSources() {
	    return this._sections.every(function (s) {
	      return s.consumer.hasContentsOfAllSources();
	    });
	  };

	/**
	 * Returns the original source content. The only argument is the url of the
	 * original source file. Returns null if no original source content is
	 * available.
	 */
	IndexedSourceMapConsumer.prototype.sourceContentFor =
	  function IndexedSourceMapConsumer_sourceContentFor(aSource, nullOnMissing) {
	    for (var i = 0; i < this._sections.length; i++) {
	      var section = this._sections[i];

	      var content = section.consumer.sourceContentFor(aSource, true);
	      if (content) {
	        return content;
	      }
	    }
	    if (nullOnMissing) {
	      return null;
	    }
	    else {
	      throw new Error('"' + aSource + '" is not in the SourceMap.');
	    }
	  };

	/**
	 * Returns the generated line and column information for the original source,
	 * line, and column positions provided. The only argument is an object with
	 * the following properties:
	 *
	 *   - source: The filename of the original source.
	 *   - line: The line number in the original source.
	 *   - column: The column number in the original source.
	 *
	 * and an object is returned with the following properties:
	 *
	 *   - line: The line number in the generated source, or null.
	 *   - column: The column number in the generated source, or null.
	 */
	IndexedSourceMapConsumer.prototype.generatedPositionFor =
	  function IndexedSourceMapConsumer_generatedPositionFor(aArgs) {
	    for (var i = 0; i < this._sections.length; i++) {
	      var section = this._sections[i];

	      // Only consider this section if the requested source is in the list of
	      // sources of the consumer.
	      if (section.consumer.sources.indexOf(util.getArg(aArgs, 'source')) === -1) {
	        continue;
	      }
	      var generatedPosition = section.consumer.generatedPositionFor(aArgs);
	      if (generatedPosition) {
	        var ret = {
	          line: generatedPosition.line +
	            (section.generatedOffset.generatedLine - 1),
	          column: generatedPosition.column +
	            (section.generatedOffset.generatedLine === generatedPosition.line
	             ? section.generatedOffset.generatedColumn - 1
	             : 0)
	        };
	        return ret;
	      }
	    }

	    return {
	      line: null,
	      column: null
	    };
	  };

	/**
	 * Parse the mappings in a string in to a data structure which we can easily
	 * query (the ordered arrays in the `this.__generatedMappings` and
	 * `this.__originalMappings` properties).
	 */
	IndexedSourceMapConsumer.prototype._parseMappings =
	  function IndexedSourceMapConsumer_parseMappings(aStr, aSourceRoot) {
	    this.__generatedMappings = [];
	    this.__originalMappings = [];
	    for (var i = 0; i < this._sections.length; i++) {
	      var section = this._sections[i];
	      var sectionMappings = section.consumer._generatedMappings;
	      for (var j = 0; j < sectionMappings.length; j++) {
	        var mapping = sectionMappings[j];

	        var source = section.consumer._sources.at(mapping.source);
	        if (section.consumer.sourceRoot !== null) {
	          source = util.join(section.consumer.sourceRoot, source);
	        }
	        this._sources.add(source);
	        source = this._sources.indexOf(source);

	        var name = section.consumer._names.at(mapping.name);
	        this._names.add(name);
	        name = this._names.indexOf(name);

	        // The mappings coming from the consumer for the section have
	        // generated positions relative to the start of the section, so we
	        // need to offset them to be relative to the start of the concatenated
	        // generated file.
	        var adjustedMapping = {
	          source: source,
	          generatedLine: mapping.generatedLine +
	            (section.generatedOffset.generatedLine - 1),
	          generatedColumn: mapping.generatedColumn +
	            (section.generatedOffset.generatedLine === mapping.generatedLine
	            ? section.generatedOffset.generatedColumn - 1
	            : 0),
	          originalLine: mapping.originalLine,
	          originalColumn: mapping.originalColumn,
	          name: name
	        };

	        this.__generatedMappings.push(adjustedMapping);
	        if (typeof adjustedMapping.originalLine === 'number') {
	          this.__originalMappings.push(adjustedMapping);
	        }
	      }
	    }

	    quickSort(this.__generatedMappings, util.compareByGeneratedPositionsDeflated);
	    quickSort(this.__originalMappings, util.compareByOriginalPositions);
	  };

	sourceMapConsumer.IndexedSourceMapConsumer = IndexedSourceMapConsumer;
	return sourceMapConsumer;
}

var hasRequiredStacktraceGps;

function requireStacktraceGps () {
	if (hasRequiredStacktraceGps) return stacktraceGps.exports;
	hasRequiredStacktraceGps = 1;
	(function (module, exports) {
		(function(root, factory) {
		    // Universal Module Definition (UMD) to support AMD, CommonJS/Node.js, Rhino, and browsers.

		    /* istanbul ignore next */
		    {
		        module.exports = factory(requireSourceMapConsumer(), require$$0__default["default"]);
		    }
		}(commonjsGlobal, function(SourceMap, StackFrame) {

		    /**
		     * Make a X-Domain request to url and callback.
		     *
		     * @param {String} url
		     * @returns {Promise} with response text if fulfilled
		     */
		    function _xdr(url) {
		        return new Promise(function(resolve, reject) {
		            var req = new XMLHttpRequest();
		            req.open('get', url);
		            req.onerror = reject;
		            req.onreadystatechange = function onreadystatechange() {
		                if (req.readyState === 4) {
		                    if ((req.status >= 200 && req.status < 300) ||
		                        (url.substr(0, 7) === 'file://' && req.responseText)) {
		                        resolve(req.responseText);
		                    } else {
		                        reject(new Error('HTTP status: ' + req.status + ' retrieving ' + url));
		                    }
		                }
		            };
		            req.send();
		        });

		    }

		    /**
		     * Convert a Base64-encoded string into its original representation.
		     * Used for inline sourcemaps.
		     *
		     * @param {String} b64str Base-64 encoded string
		     * @returns {String} original representation of the base64-encoded string.
		     */
		    function _atob(b64str) {
		        if (typeof window !== 'undefined' && window.atob) {
		            return window.atob(b64str);
		        } else {
		            throw new Error('You must supply a polyfill for window.atob in this environment');
		        }
		    }

		    function _parseJson(string) {
		        if (typeof JSON !== 'undefined' && JSON.parse) {
		            return JSON.parse(string);
		        } else {
		            throw new Error('You must supply a polyfill for JSON.parse in this environment');
		        }
		    }

		    function _findFunctionName(source, lineNumber/*, columnNumber*/) {
		        var syntaxes = [
		            // {name} = function ({args}) TODO args capture
		            /['"]?([$_A-Za-z][$_A-Za-z0-9]*)['"]?\s*[:=]\s*function\b/,
		            // function {name}({args}) m[1]=name m[2]=args
		            /function\s+([^('"`]*?)\s*\(([^)]*)\)/,
		            // {name} = eval()
		            /['"]?([$_A-Za-z][$_A-Za-z0-9]*)['"]?\s*[:=]\s*(?:eval|new Function)\b/,
		            // fn_name() {
		            /\b(?!(?:if|for|switch|while|with|catch)\b)(?:(?:static)\s+)?(\S+)\s*\(.*?\)\s*\{/,
		            // {name} = () => {
		            /['"]?([$_A-Za-z][$_A-Za-z0-9]*)['"]?\s*[:=]\s*\(.*?\)\s*=>/
		        ];
		        var lines = source.split('\n');

		        // Walk backwards in the source lines until we find the line which matches one of the patterns above
		        var code = '';
		        var maxLines = Math.min(lineNumber, 20);
		        for (var i = 0; i < maxLines; ++i) {
		            // lineNo is 1-based, source[] is 0-based
		            var line = lines[lineNumber - i - 1];
		            var commentPos = line.indexOf('//');
		            if (commentPos >= 0) {
		                line = line.substr(0, commentPos);
		            }

		            if (line) {
		                code = line + code;
		                var len = syntaxes.length;
		                for (var index = 0; index < len; index++) {
		                    var m = syntaxes[index].exec(code);
		                    if (m && m[1]) {
		                        return m[1];
		                    }
		                }
		            }
		        }
		        return undefined;
		    }

		    function _ensureSupportedEnvironment() {
		        if (typeof Object.defineProperty !== 'function' || typeof Object.create !== 'function') {
		            throw new Error('Unable to consume source maps in older browsers');
		        }
		    }

		    function _ensureStackFrameIsLegit(stackframe) {
		        if (typeof stackframe !== 'object') {
		            throw new TypeError('Given StackFrame is not an object');
		        } else if (typeof stackframe.fileName !== 'string') {
		            throw new TypeError('Given file name is not a String');
		        } else if (typeof stackframe.lineNumber !== 'number' ||
		            stackframe.lineNumber % 1 !== 0 ||
		            stackframe.lineNumber < 1) {
		            throw new TypeError('Given line number must be a positive integer');
		        } else if (typeof stackframe.columnNumber !== 'number' ||
		            stackframe.columnNumber % 1 !== 0 ||
		            stackframe.columnNumber < 0) {
		            throw new TypeError('Given column number must be a non-negative integer');
		        }
		        return true;
		    }

		    function _findSourceMappingURL(source) {
		        var sourceMappingUrlRegExp = /\/\/[#@] ?sourceMappingURL=([^\s'"]+)\s*$/mg;
		        var lastSourceMappingUrl;
		        var matchSourceMappingUrl;
		        // eslint-disable-next-line no-cond-assign
		        while (matchSourceMappingUrl = sourceMappingUrlRegExp.exec(source)) {
		            lastSourceMappingUrl = matchSourceMappingUrl[1];
		        }
		        if (lastSourceMappingUrl) {
		            return lastSourceMappingUrl;
		        } else {
		            throw new Error('sourceMappingURL not found');
		        }
		    }

		    function _extractLocationInfoFromSourceMapSource(stackframe, sourceMapConsumer, sourceCache) {
		        return new Promise(function(resolve, reject) {
		            var loc = sourceMapConsumer.originalPositionFor({
		                line: stackframe.lineNumber,
		                column: stackframe.columnNumber
		            });

		            if (loc.source) {
		                // cache mapped sources
		                var mappedSource = sourceMapConsumer.sourceContentFor(loc.source);
		                if (mappedSource) {
		                    sourceCache[loc.source] = mappedSource;
		                }

		                resolve(
		                    // given stackframe and source location, update stackframe
		                    new StackFrame({
		                        functionName: loc.name || stackframe.functionName,
		                        args: stackframe.args,
		                        fileName: loc.source,
		                        lineNumber: loc.line,
		                        columnNumber: loc.column
		                    }));
		            } else {
		                reject(new Error('Could not get original source for given stackframe and source map'));
		            }
		        });
		    }

		    /**
		     * @constructor
		     * @param {Object} opts
		     *      opts.sourceCache = {url: "Source String"} => preload source cache
		     *      opts.sourceMapConsumerCache = {/path/file.js.map: SourceMapConsumer}
		     *      opts.offline = True to prevent network requests.
		     *              Best effort without sources or source maps.
		     *      opts.ajax = Promise returning function to make X-Domain requests
		     */
		    return function StackTraceGPS(opts) {
		        if (!(this instanceof StackTraceGPS)) {
		            return new StackTraceGPS(opts);
		        }
		        opts = opts || {};

		        this.sourceCache = opts.sourceCache || {};
		        this.sourceMapConsumerCache = opts.sourceMapConsumerCache || {};

		        this.ajax = opts.ajax || _xdr;

		        this._atob = opts.atob || _atob;

		        this._get = function _get(location) {
		            return new Promise(function(resolve, reject) {
		                var isDataUrl = location.substr(0, 5) === 'data:';
		                if (this.sourceCache[location]) {
		                    resolve(this.sourceCache[location]);
		                } else if (opts.offline && !isDataUrl) {
		                    reject(new Error('Cannot make network requests in offline mode'));
		                } else {
		                    if (isDataUrl) {
		                        // data URLs can have parameters.
		                        // see http://tools.ietf.org/html/rfc2397
		                        var supportedEncodingRegexp =
		                            /^data:application\/json;([\w=:"-]+;)*base64,/;
		                        var match = location.match(supportedEncodingRegexp);
		                        if (match) {
		                            var sourceMapStart = match[0].length;
		                            var encodedSource = location.substr(sourceMapStart);
		                            var source = this._atob(encodedSource);
		                            this.sourceCache[location] = source;
		                            resolve(source);
		                        } else {
		                            reject(new Error('The encoding of the inline sourcemap is not supported'));
		                        }
		                    } else {
		                        var xhrPromise = this.ajax(location, {method: 'get'});
		                        // Cache the Promise to prevent duplicate in-flight requests
		                        this.sourceCache[location] = xhrPromise;
		                        xhrPromise.then(resolve, reject);
		                    }
		                }
		            }.bind(this));
		        };

		        /**
		         * Creating SourceMapConsumers is expensive, so this wraps the creation of a
		         * SourceMapConsumer in a per-instance cache.
		         *
		         * @param {String} sourceMappingURL = URL to fetch source map from
		         * @param {String} defaultSourceRoot = Default source root for source map if undefined
		         * @returns {Promise} that resolves a SourceMapConsumer
		         */
		        this._getSourceMapConsumer = function _getSourceMapConsumer(sourceMappingURL, defaultSourceRoot) {
		            return new Promise(function(resolve) {
		                if (this.sourceMapConsumerCache[sourceMappingURL]) {
		                    resolve(this.sourceMapConsumerCache[sourceMappingURL]);
		                } else {
		                    var sourceMapConsumerPromise = new Promise(function(resolve, reject) {
		                        return this._get(sourceMappingURL).then(function(sourceMapSource) {
		                            if (typeof sourceMapSource === 'string') {
		                                sourceMapSource = _parseJson(sourceMapSource.replace(/^\)\]\}'/, ''));
		                            }
		                            if (typeof sourceMapSource.sourceRoot === 'undefined') {
		                                sourceMapSource.sourceRoot = defaultSourceRoot;
		                            }

		                            resolve(new SourceMap.SourceMapConsumer(sourceMapSource));
		                        }).catch(reject);
		                    }.bind(this));
		                    this.sourceMapConsumerCache[sourceMappingURL] = sourceMapConsumerPromise;
		                    resolve(sourceMapConsumerPromise);
		                }
		            }.bind(this));
		        };

		        /**
		         * Given a StackFrame, enhance function name and use source maps for a
		         * better StackFrame.
		         *
		         * @param {StackFrame} stackframe object
		         * @returns {Promise} that resolves with with source-mapped StackFrame
		         */
		        this.pinpoint = function StackTraceGPS$$pinpoint(stackframe) {
		            return new Promise(function(resolve, reject) {
		                this.getMappedLocation(stackframe).then(function(mappedStackFrame) {
		                    function resolveMappedStackFrame() {
		                        resolve(mappedStackFrame);
		                    }

		                    this.findFunctionName(mappedStackFrame)
		                        .then(resolve, resolveMappedStackFrame)
		                        // eslint-disable-next-line no-unexpected-multiline
		                        ['catch'](resolveMappedStackFrame);
		                }.bind(this), reject);
		            }.bind(this));
		        };

		        /**
		         * Given a StackFrame, guess function name from location information.
		         *
		         * @param {StackFrame} stackframe
		         * @returns {Promise} that resolves with enhanced StackFrame.
		         */
		        this.findFunctionName = function StackTraceGPS$$findFunctionName(stackframe) {
		            return new Promise(function(resolve, reject) {
		                _ensureStackFrameIsLegit(stackframe);
		                this._get(stackframe.fileName).then(function getSourceCallback(source) {
		                    var lineNumber = stackframe.lineNumber;
		                    var columnNumber = stackframe.columnNumber;
		                    var guessedFunctionName = _findFunctionName(source, lineNumber);
		                    // Only replace functionName if we found something
		                    if (guessedFunctionName) {
		                        resolve(new StackFrame({
		                            functionName: guessedFunctionName,
		                            args: stackframe.args,
		                            fileName: stackframe.fileName,
		                            lineNumber: lineNumber,
		                            columnNumber: columnNumber
		                        }));
		                    } else {
		                        resolve(stackframe);
		                    }
		                }, reject)['catch'](reject);
		            }.bind(this));
		        };

		        /**
		         * Given a StackFrame, seek source-mapped location and return new enhanced StackFrame.
		         *
		         * @param {StackFrame} stackframe
		         * @returns {Promise} that resolves with enhanced StackFrame.
		         */
		        this.getMappedLocation = function StackTraceGPS$$getMappedLocation(stackframe) {
		            return new Promise(function(resolve, reject) {
		                _ensureSupportedEnvironment();
		                _ensureStackFrameIsLegit(stackframe);

		                var sourceCache = this.sourceCache;
		                var fileName = stackframe.fileName;
		                this._get(fileName).then(function(source) {
		                    var sourceMappingURL = _findSourceMappingURL(source);
		                    var isDataUrl = sourceMappingURL.substr(0, 5) === 'data:';
		                    var defaultSourceRoot = fileName.substring(0, fileName.lastIndexOf('/') + 1);

		                    if (sourceMappingURL[0] !== '/' && !isDataUrl && !(/^https?:\/\/|^\/\//i).test(sourceMappingURL)) {
		                        sourceMappingURL = defaultSourceRoot + sourceMappingURL;
		                    }

		                    return this._getSourceMapConsumer(sourceMappingURL, defaultSourceRoot)
		                        .then(function(sourceMapConsumer) {
		                            return _extractLocationInfoFromSourceMapSource(stackframe, sourceMapConsumer, sourceCache)
		                                .then(resolve)['catch'](function() {
		                                    resolve(stackframe);
		                                });
		                        });
		                }.bind(this), reject)['catch'](reject);
		            }.bind(this));
		        };
		    };
		}));
} (stacktraceGps));
	return stacktraceGps.exports;
}

(function (module, exports) {
	(function(root, factory) {
	    // Universal Module Definition (UMD) to support AMD, CommonJS/Node.js, Rhino, and browsers.

	    /* istanbul ignore next */
	    {
	        module.exports = factory(requireErrorStackParser(), require$$1__default["default"], requireStacktraceGps());
	    }
	}(commonjsGlobal, function StackTrace(ErrorStackParser, StackGenerator, StackTraceGPS) {
	    var _options = {
	        filter: function(stackframe) {
	            // Filter out stackframes for this library by default
	            return (stackframe.functionName || '').indexOf('StackTrace$$') === -1 &&
	                (stackframe.functionName || '').indexOf('ErrorStackParser$$') === -1 &&
	                (stackframe.functionName || '').indexOf('StackTraceGPS$$') === -1 &&
	                (stackframe.functionName || '').indexOf('StackGenerator$$') === -1;
	        },
	        sourceCache: {}
	    };

	    var _generateError = function StackTrace$$GenerateError() {
	        try {
	            // Error must be thrown to get stack in IE
	            throw new Error();
	        } catch (err) {
	            return err;
	        }
	    };

	    /**
	     * Merge 2 given Objects. If a conflict occurs the second object wins.
	     * Does not do deep merges.
	     *
	     * @param {Object} first base object
	     * @param {Object} second overrides
	     * @returns {Object} merged first and second
	     * @private
	     */
	    function _merge(first, second) {
	        var target = {};

	        [first, second].forEach(function(obj) {
	            for (var prop in obj) {
	                if (Object.prototype.hasOwnProperty.call(obj, prop)) {
	                    target[prop] = obj[prop];
	                }
	            }
	            return target;
	        });

	        return target;
	    }

	    function _isShapedLikeParsableError(err) {
	        return err.stack || err['opera#sourceloc'];
	    }

	    function _filtered(stackframes, filter) {
	        if (typeof filter === 'function') {
	            return stackframes.filter(filter);
	        }
	        return stackframes;
	    }

	    return {
	        /**
	         * Get a backtrace from invocation point.
	         *
	         * @param {Object} opts
	         * @returns {Array} of StackFrame
	         */
	        get: function StackTrace$$get(opts) {
	            var err = _generateError();
	            return _isShapedLikeParsableError(err) ? this.fromError(err, opts) : this.generateArtificially(opts);
	        },

	        /**
	         * Get a backtrace from invocation point.
	         * IMPORTANT: Does not handle source maps or guess function names!
	         *
	         * @param {Object} opts
	         * @returns {Array} of StackFrame
	         */
	        getSync: function StackTrace$$getSync(opts) {
	            opts = _merge(_options, opts);
	            var err = _generateError();
	            var stack = _isShapedLikeParsableError(err) ? ErrorStackParser.parse(err) : StackGenerator.backtrace(opts);
	            return _filtered(stack, opts.filter);
	        },

	        /**
	         * Given an error object, parse it.
	         *
	         * @param {Error} error object
	         * @param {Object} opts
	         * @returns {Promise} for Array[StackFrame}
	         */
	        fromError: function StackTrace$$fromError(error, opts) {
	            opts = _merge(_options, opts);
	            var gps = new StackTraceGPS(opts);
	            return new Promise(function(resolve) {
	                var stackframes = _filtered(ErrorStackParser.parse(error), opts.filter);
	                resolve(Promise.all(stackframes.map(function(sf) {
	                    return new Promise(function(resolve) {
	                        function resolveOriginal() {
	                            resolve(sf);
	                        }

	                        gps.pinpoint(sf).then(resolve, resolveOriginal)['catch'](resolveOriginal);
	                    });
	                })));
	            }.bind(this));
	        },

	        /**
	         * Use StackGenerator to generate a backtrace.
	         *
	         * @param {Object} opts
	         * @returns {Promise} of Array[StackFrame]
	         */
	        generateArtificially: function StackTrace$$generateArtificially(opts) {
	            opts = _merge(_options, opts);
	            var stackFrames = StackGenerator.backtrace(opts);
	            if (typeof opts.filter === 'function') {
	                stackFrames = stackFrames.filter(opts.filter);
	            }
	            return Promise.resolve(stackFrames);
	        },

	        /**
	         * Given a function, wrap it such that invocations trigger a callback that
	         * is called with a stack trace.
	         *
	         * @param {Function} fn to be instrumented
	         * @param {Function} callback function to call with a stack trace on invocation
	         * @param {Function} errback optional function to call with error if unable to get stack trace.
	         * @param {Object} thisArg optional context object (e.g. window)
	         */
	        instrument: function StackTrace$$instrument(fn, callback, errback, thisArg) {
	            if (typeof fn !== 'function') {
	                throw new Error('Cannot instrument non-function object');
	            } else if (typeof fn.__stacktraceOriginalFn === 'function') {
	                // Already instrumented, return given Function
	                return fn;
	            }

	            var instrumented = function StackTrace$$instrumented() {
	                try {
	                    this.get().then(callback, errback)['catch'](errback);
	                    return fn.apply(thisArg || this, arguments);
	                } catch (e) {
	                    if (_isShapedLikeParsableError(e)) {
	                        this.fromError(e).then(callback, errback)['catch'](errback);
	                    }
	                    throw e;
	                }
	            }.bind(this);
	            instrumented.__stacktraceOriginalFn = fn;

	            return instrumented;
	        },

	        /**
	         * Given a function that has been instrumented,
	         * revert the function to it's original (non-instrumented) state.
	         *
	         * @param {Function} fn to de-instrument
	         */
	        deinstrument: function StackTrace$$deinstrument(fn) {
	            if (typeof fn !== 'function') {
	                throw new Error('Cannot de-instrument non-function object');
	            } else if (typeof fn.__stacktraceOriginalFn === 'function') {
	                return fn.__stacktraceOriginalFn;
	            } else {
	                // Function not instrumented, return original
	                return fn;
	            }
	        },

	        /**
	         * Given an error message and Array of StackFrames, serialize and POST to given URL.
	         *
	         * @param {Array} stackframes
	         * @param {String} url
	         * @param {String} errorMsg
	         * @param {Object} requestOptions
	         */
	        report: function StackTrace$$report(stackframes, url, errorMsg, requestOptions) {
	            return new Promise(function(resolve, reject) {
	                var req = new XMLHttpRequest();
	                req.onerror = reject;
	                req.onreadystatechange = function onreadystatechange() {
	                    if (req.readyState === 4) {
	                        if (req.status >= 200 && req.status < 400) {
	                            resolve(req.responseText);
	                        } else {
	                            reject(new Error('POST to ' + url + ' failed with status: ' + req.status));
	                        }
	                    }
	                };
	                req.open('post', url);

	                // Set request headers
	                req.setRequestHeader('Content-Type', 'application/json');
	                if (requestOptions && typeof requestOptions.headers === 'object') {
	                    var headers = requestOptions.headers;
	                    for (var header in headers) {
	                        if (Object.prototype.hasOwnProperty.call(headers, header)) {
	                            req.setRequestHeader(header, headers[header]);
	                        }
	                    }
	                }

	                var reportPayload = {stack: stackframes};
	                if (errorMsg !== undefined && errorMsg !== null) {
	                    reportPayload.message = errorMsg;
	                }

	                req.send(JSON.stringify(reportPayload));
	            });
	        }
	    };
	}));
} (stacktrace));

class SourceMapService {
    constructor(config) {
        this.config = config;
    }
    isEnabled() {
        return this.config.enabled;
    }
    async mapStackTrace(stack) {
        if (!this.isEnabled()) {
            return stack;
        }
        try {
            // 使用 stacktrace-js 解析错误堆栈
            const stackFrames = await stacktrace.exports.fromError(new Error(stack));
            // 将堆栈帧转换为可读字符串
            const mappedStack = stackFrames
                .map(frame => {
                let source = frame.fileName || '';
                // 移除项目根路径前缀
                if (this.config.stripProjectRoot && source.startsWith(this.config.stripProjectRoot)) {
                    source = source.substring(this.config.stripProjectRoot.length);
                }
                return `    at ${frame.functionName || '(anonymous)'} (${source}:${frame.lineNumber}:${frame.columnNumber})`;
            })
                .join('\n');
            return mappedStack;
        }
        catch (error) {
            console.error('Error mapping stack trace:', error);
            return stack; // 如果映射失败，返回原始堆栈
        }
    }
    async uploadSourceMap(sourceMapFile, sourceFile) {
        if (!this.isEnabled() || !this.config.uploadSourceMap || !this.config.sourceMapEndpoint) {
            return false;
        }
        try {
            const formData = new FormData();
            formData.append('sourceMap', sourceMapFile);
            formData.append('sourceFile', sourceFile);
            if (this.config.includeSourceContent) {
                // 读取源文件内容
                const sourceContent = await this.readFileAsText(sourceMapFile);
                formData.append('sourceContent', sourceContent);
            }
            const response = await fetch(this.config.sourceMapEndpoint, {
                method: 'POST',
                body: formData
            });
            return response.ok;
        }
        catch (error) {
            console.error('Error uploading source map:', error);
            return false;
        }
    }
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }
}

class FallbackService {
    constructor(config) {
        this.errorCount = 0;
        this.errorTimestamps = [];
        this.config = config;
        this.init();
    }
    init() {
        // 监听全局错误以计数
        window.addEventListener('error', this.handleError.bind(this));
        window.addEventListener('unhandledrejection', this.handleError.bind(this));
    }
    handleError(event) {
        console.log(event);
        const now = Date.now();
        // 添加当前错误时间戳
        this.errorTimestamps.push(now);
        // 清理超出时间窗口的错误
        this.errorTimestamps = this.errorTimestamps.filter(timestamp => now - timestamp <= this.config.timeWindow);
        // 更新错误计数
        this.errorCount = this.errorTimestamps.length;
        // 检查是否需要跳转到 fallback 页面
        if (this.errorCount >= this.config.errorThreshold) {
            this.redirectToFallback();
        }
    }
    redirectToFallback() {
        // 防止循环重定向
        if (window.location.pathname === this.config.fallbackUrl) {
            return;
        }
        // 保存当前 URL 以便恢复
        sessionStorage.setItem('errorMonitor_previousUrl', window.location.href);
        // 跳转到 fallback 页面
        window.location.href = this.config.fallbackUrl;
    }
    destroy() {
        window.removeEventListener('error', this.handleError.bind(this));
        window.removeEventListener('unhandledrejection', this.handleError.bind(this));
    }
}

class WhiteScreenDetector {
    constructor(reportService, config) {
        this.checkInterval = null;
        this.hasReported = false;
        this.reportService = reportService;
        this.config = config;
        this.init();
    }
    init() {
        // 页面加载完成后开始检测
        if (document.readyState === 'complete') {
            this.startDetection();
        }
        else {
            window.addEventListener('load', () => {
                this.startDetection();
            });
        }
    }
    startDetection() {
        // 设置超时检测
        setTimeout(() => {
            this.checkForWhiteScreen();
        }, this.config.timeout);
        // 定期检测
        if (this.config.checkInterval > 0) {
            this.checkInterval = window.setInterval(() => {
                this.checkForWhiteScreen();
            }, this.config.checkInterval);
        }
    }
    checkForWhiteScreen() {
        // 如果已经报告过，不再重复检测
        if (this.hasReported) {
            this.stopDetection();
            return;
        }
        // 检查页面是否为白屏
        const isWhiteScreen = this.isPageWhiteScreen();
        if (isWhiteScreen) {
            this.reportWhiteScreen();
            this.hasReported = true;
            this.stopDetection();
        }
    }
    isPageWhiteScreen() {
        // 获取有效元素数量
        let validElementsCount = 0;
        // 检查指定选择器的元素
        for (const selector of this.config.validSelectors) {
            validElementsCount += document.querySelectorAll(selector).length;
        }
        // 如果有效元素数量少于阈值，认为是白屏
        return validElementsCount < this.config.minValidElements;
    }
    reportWhiteScreen() {
        // 收集页面信息
        const pageInfo = {
            url: window.location.href,
            userAgent: navigator.userAgent,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
            domContentLoaded: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
            loadTime: performance.timing.loadEventEnd - performance.timing.navigationStart,
            htmlContent: this.getSafeHtmlSnapshot()
        };
        // 上报白屏事件
        this.reportService.reportError({
            type: 'white_screen',
            message: 'White screen detected',
            pageInfo,
            timestamp: new Date().toISOString()
        });
    }
    getSafeHtmlSnapshot() {
        try {
            // 获取 HTML 快照，但限制大小
            const html = document.documentElement.outerHTML;
            const maxLength = 5000; // 限制 HTML 大小
            return html.length > maxLength ? html.substring(0, maxLength) + '...' : html;
        }
        catch (e) {
            return 'Failed to capture HTML snapshot';
        }
    }
    stopDetection() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }
    destroy() {
        this.stopDetection();
    }
}

// Unique ID creation requires a high quality random # generator. In the browser we therefore
// require the crypto API and do not support built-in fallback to lower quality random number
// generators (like Math.random()).
var getRandomValues;
var rnds8 = new Uint8Array(16);
function rng() {
  // lazy load so that environments that need to polyfill have a chance to do so
  if (!getRandomValues) {
    // getRandomValues needs to be invoked in a context where "this" is a Crypto implementation. Also,
    // find the complete implementation of crypto (msCrypto) on IE11.
    getRandomValues = typeof crypto !== 'undefined' && crypto.getRandomValues && crypto.getRandomValues.bind(crypto) || typeof msCrypto !== 'undefined' && typeof msCrypto.getRandomValues === 'function' && msCrypto.getRandomValues.bind(msCrypto);

    if (!getRandomValues) {
      throw new Error('crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported');
    }
  }

  return getRandomValues(rnds8);
}

var REGEX = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;

function validate(uuid) {
  return typeof uuid === 'string' && REGEX.test(uuid);
}

/**
 * Convert array of 16 byte values to UUID string format of the form:
 * XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */

var byteToHex = [];

for (var i = 0; i < 256; ++i) {
  byteToHex.push((i + 0x100).toString(16).substr(1));
}

function stringify(arr) {
  var offset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  // Note: Be careful editing this code!  It's been tuned for performance
  // and works in ways you may not expect. See https://github.com/uuidjs/uuid/pull/434
  var uuid = (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + '-' + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + '-' + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + '-' + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + '-' + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase(); // Consistency check for valid UUID.  If this throws, it's likely due to one
  // of the following:
  // - One or more input array values don't map to a hex octet (leading to
  // "undefined" in the uuid)
  // - Invalid input values for the RFC `version` or `variant` fields

  if (!validate(uuid)) {
    throw TypeError('Stringified UUID is invalid');
  }

  return uuid;
}

function parse(uuid) {
  if (!validate(uuid)) {
    throw TypeError('Invalid UUID');
  }

  var v;
  var arr = new Uint8Array(16); // Parse ########-....-....-....-............

  arr[0] = (v = parseInt(uuid.slice(0, 8), 16)) >>> 24;
  arr[1] = v >>> 16 & 0xff;
  arr[2] = v >>> 8 & 0xff;
  arr[3] = v & 0xff; // Parse ........-####-....-....-............

  arr[4] = (v = parseInt(uuid.slice(9, 13), 16)) >>> 8;
  arr[5] = v & 0xff; // Parse ........-....-####-....-............

  arr[6] = (v = parseInt(uuid.slice(14, 18), 16)) >>> 8;
  arr[7] = v & 0xff; // Parse ........-....-....-####-............

  arr[8] = (v = parseInt(uuid.slice(19, 23), 16)) >>> 8;
  arr[9] = v & 0xff; // Parse ........-....-....-....-############
  // (Use "/" to avoid 32-bit truncation when bit-shifting high-order bytes)

  arr[10] = (v = parseInt(uuid.slice(24, 36), 16)) / 0x10000000000 & 0xff;
  arr[11] = v / 0x100000000 & 0xff;
  arr[12] = v >>> 24 & 0xff;
  arr[13] = v >>> 16 & 0xff;
  arr[14] = v >>> 8 & 0xff;
  arr[15] = v & 0xff;
  return arr;
}

function stringToBytes(str) {
  str = unescape(encodeURIComponent(str)); // UTF8 escape

  var bytes = [];

  for (var i = 0; i < str.length; ++i) {
    bytes.push(str.charCodeAt(i));
  }

  return bytes;
}

var DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
var URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
function v35 (name, version, hashfunc) {
  function generateUUID(value, namespace, buf, offset) {
    if (typeof value === 'string') {
      value = stringToBytes(value);
    }

    if (typeof namespace === 'string') {
      namespace = parse(namespace);
    }

    if (namespace.length !== 16) {
      throw TypeError('Namespace must be array-like (16 iterable integer values, 0-255)');
    } // Compute hash of namespace and value, Per 4.3
    // Future: Use spread syntax when supported on all platforms, e.g. `bytes =
    // hashfunc([...namespace, ... value])`


    var bytes = new Uint8Array(16 + value.length);
    bytes.set(namespace);
    bytes.set(value, namespace.length);
    bytes = hashfunc(bytes);
    bytes[6] = bytes[6] & 0x0f | version;
    bytes[8] = bytes[8] & 0x3f | 0x80;

    if (buf) {
      offset = offset || 0;

      for (var i = 0; i < 16; ++i) {
        buf[offset + i] = bytes[i];
      }

      return buf;
    }

    return stringify(bytes);
  } // Function#name is not settable on some platforms (#270)


  try {
    generateUUID.name = name; // eslint-disable-next-line no-empty
  } catch (err) {} // For CommonJS default export support


  generateUUID.DNS = DNS;
  generateUUID.URL = URL;
  return generateUUID;
}

/*
 * Browser-compatible JavaScript MD5
 *
 * Modification of JavaScript MD5
 * https://github.com/blueimp/JavaScript-MD5
 *
 * Copyright 2011, Sebastian Tschan
 * https://blueimp.net
 *
 * Licensed under the MIT license:
 * https://opensource.org/licenses/MIT
 *
 * Based on
 * A JavaScript implementation of the RSA Data Security, Inc. MD5 Message
 * Digest Algorithm, as defined in RFC 1321.
 * Version 2.2 Copyright (C) Paul Johnston 1999 - 2009
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for more info.
 */
function md5(bytes) {
  if (typeof bytes === 'string') {
    var msg = unescape(encodeURIComponent(bytes)); // UTF8 escape

    bytes = new Uint8Array(msg.length);

    for (var i = 0; i < msg.length; ++i) {
      bytes[i] = msg.charCodeAt(i);
    }
  }

  return md5ToHexEncodedArray(wordsToMd5(bytesToWords(bytes), bytes.length * 8));
}
/*
 * Convert an array of little-endian words to an array of bytes
 */


function md5ToHexEncodedArray(input) {
  var output = [];
  var length32 = input.length * 32;
  var hexTab = '0123456789abcdef';

  for (var i = 0; i < length32; i += 8) {
    var x = input[i >> 5] >>> i % 32 & 0xff;
    var hex = parseInt(hexTab.charAt(x >>> 4 & 0x0f) + hexTab.charAt(x & 0x0f), 16);
    output.push(hex);
  }

  return output;
}
/**
 * Calculate output length with padding and bit length
 */


function getOutputLength(inputLength8) {
  return (inputLength8 + 64 >>> 9 << 4) + 14 + 1;
}
/*
 * Calculate the MD5 of an array of little-endian words, and a bit length.
 */


function wordsToMd5(x, len) {
  /* append padding */
  x[len >> 5] |= 0x80 << len % 32;
  x[getOutputLength(len) - 1] = len;
  var a = 1732584193;
  var b = -271733879;
  var c = -1732584194;
  var d = 271733878;

  for (var i = 0; i < x.length; i += 16) {
    var olda = a;
    var oldb = b;
    var oldc = c;
    var oldd = d;
    a = md5ff(a, b, c, d, x[i], 7, -680876936);
    d = md5ff(d, a, b, c, x[i + 1], 12, -389564586);
    c = md5ff(c, d, a, b, x[i + 2], 17, 606105819);
    b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = md5ff(a, b, c, d, x[i + 4], 7, -176418897);
    d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426);
    c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341);
    b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416);
    d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417);
    c = md5ff(c, d, a, b, x[i + 10], 17, -42063);
    b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682);
    d = md5ff(d, a, b, c, x[i + 13], 12, -40341101);
    c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290);
    b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);
    a = md5gg(a, b, c, d, x[i + 1], 5, -165796510);
    d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632);
    c = md5gg(c, d, a, b, x[i + 11], 14, 643717713);
    b = md5gg(b, c, d, a, x[i], 20, -373897302);
    a = md5gg(a, b, c, d, x[i + 5], 5, -701558691);
    d = md5gg(d, a, b, c, x[i + 10], 9, 38016083);
    c = md5gg(c, d, a, b, x[i + 15], 14, -660478335);
    b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = md5gg(a, b, c, d, x[i + 9], 5, 568446438);
    d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690);
    c = md5gg(c, d, a, b, x[i + 3], 14, -187363961);
    b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467);
    d = md5gg(d, a, b, c, x[i + 2], 9, -51403784);
    c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473);
    b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);
    a = md5hh(a, b, c, d, x[i + 5], 4, -378558);
    d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463);
    c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562);
    b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060);
    d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353);
    c = md5hh(c, d, a, b, x[i + 7], 16, -155497632);
    b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = md5hh(a, b, c, d, x[i + 13], 4, 681279174);
    d = md5hh(d, a, b, c, x[i], 11, -358537222);
    c = md5hh(c, d, a, b, x[i + 3], 16, -722521979);
    b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = md5hh(a, b, c, d, x[i + 9], 4, -640364487);
    d = md5hh(d, a, b, c, x[i + 12], 11, -421815835);
    c = md5hh(c, d, a, b, x[i + 15], 16, 530742520);
    b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);
    a = md5ii(a, b, c, d, x[i], 6, -198630844);
    d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415);
    c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905);
    b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571);
    d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606);
    c = md5ii(c, d, a, b, x[i + 10], 15, -1051523);
    b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359);
    d = md5ii(d, a, b, c, x[i + 15], 10, -30611744);
    c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380);
    b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = md5ii(a, b, c, d, x[i + 4], 6, -145523070);
    d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379);
    c = md5ii(c, d, a, b, x[i + 2], 15, 718787259);
    b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);
    a = safeAdd(a, olda);
    b = safeAdd(b, oldb);
    c = safeAdd(c, oldc);
    d = safeAdd(d, oldd);
  }

  return [a, b, c, d];
}
/*
 * Convert an array bytes to an array of little-endian words
 * Characters >255 have their high-byte silently ignored.
 */


function bytesToWords(input) {
  if (input.length === 0) {
    return [];
  }

  var length8 = input.length * 8;
  var output = new Uint32Array(getOutputLength(length8));

  for (var i = 0; i < length8; i += 8) {
    output[i >> 5] |= (input[i / 8] & 0xff) << i % 32;
  }

  return output;
}
/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */


function safeAdd(x, y) {
  var lsw = (x & 0xffff) + (y & 0xffff);
  var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return msw << 16 | lsw & 0xffff;
}
/*
 * Bitwise rotate a 32-bit number to the left.
 */


function bitRotateLeft(num, cnt) {
  return num << cnt | num >>> 32 - cnt;
}
/*
 * These functions implement the four basic operations the algorithm uses.
 */


function md5cmn(q, a, b, x, s, t) {
  return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
}

function md5ff(a, b, c, d, x, s, t) {
  return md5cmn(b & c | ~b & d, a, b, x, s, t);
}

function md5gg(a, b, c, d, x, s, t) {
  return md5cmn(b & d | c & ~d, a, b, x, s, t);
}

function md5hh(a, b, c, d, x, s, t) {
  return md5cmn(b ^ c ^ d, a, b, x, s, t);
}

function md5ii(a, b, c, d, x, s, t) {
  return md5cmn(c ^ (b | ~d), a, b, x, s, t);
}

v35('v3', 0x30, md5);

function v4(options, buf, offset) {
  options = options || {};
  var rnds = options.random || (options.rng || rng)(); // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`

  rnds[6] = rnds[6] & 0x0f | 0x40;
  rnds[8] = rnds[8] & 0x3f | 0x80; // Copy bytes to buffer, if provided

  if (buf) {
    offset = offset || 0;

    for (var i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }

    return buf;
  }

  return stringify(rnds);
}

// Adapted from Chris Veness' SHA1 code at
// http://www.movable-type.co.uk/scripts/sha1.html
function f(s, x, y, z) {
  switch (s) {
    case 0:
      return x & y ^ ~x & z;

    case 1:
      return x ^ y ^ z;

    case 2:
      return x & y ^ x & z ^ y & z;

    case 3:
      return x ^ y ^ z;
  }
}

function ROTL(x, n) {
  return x << n | x >>> 32 - n;
}

function sha1(bytes) {
  var K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];
  var H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

  if (typeof bytes === 'string') {
    var msg = unescape(encodeURIComponent(bytes)); // UTF8 escape

    bytes = [];

    for (var i = 0; i < msg.length; ++i) {
      bytes.push(msg.charCodeAt(i));
    }
  } else if (!Array.isArray(bytes)) {
    // Convert Array-like to Array
    bytes = Array.prototype.slice.call(bytes);
  }

  bytes.push(0x80);
  var l = bytes.length / 4 + 2;
  var N = Math.ceil(l / 16);
  var M = new Array(N);

  for (var _i = 0; _i < N; ++_i) {
    var arr = new Uint32Array(16);

    for (var j = 0; j < 16; ++j) {
      arr[j] = bytes[_i * 64 + j * 4] << 24 | bytes[_i * 64 + j * 4 + 1] << 16 | bytes[_i * 64 + j * 4 + 2] << 8 | bytes[_i * 64 + j * 4 + 3];
    }

    M[_i] = arr;
  }

  M[N - 1][14] = (bytes.length - 1) * 8 / Math.pow(2, 32);
  M[N - 1][14] = Math.floor(M[N - 1][14]);
  M[N - 1][15] = (bytes.length - 1) * 8 & 0xffffffff;

  for (var _i2 = 0; _i2 < N; ++_i2) {
    var W = new Uint32Array(80);

    for (var t = 0; t < 16; ++t) {
      W[t] = M[_i2][t];
    }

    for (var _t = 16; _t < 80; ++_t) {
      W[_t] = ROTL(W[_t - 3] ^ W[_t - 8] ^ W[_t - 14] ^ W[_t - 16], 1);
    }

    var a = H[0];
    var b = H[1];
    var c = H[2];
    var d = H[3];
    var e = H[4];

    for (var _t2 = 0; _t2 < 80; ++_t2) {
      var s = Math.floor(_t2 / 20);
      var T = ROTL(a, 5) + f(s, b, c, d) + e + K[s] + W[_t2] >>> 0;
      e = d;
      d = c;
      c = ROTL(b, 30) >>> 0;
      b = a;
      a = T;
    }

    H[0] = H[0] + a >>> 0;
    H[1] = H[1] + b >>> 0;
    H[2] = H[2] + c >>> 0;
    H[3] = H[3] + d >>> 0;
    H[4] = H[4] + e >>> 0;
  }

  return [H[0] >> 24 & 0xff, H[0] >> 16 & 0xff, H[0] >> 8 & 0xff, H[0] & 0xff, H[1] >> 24 & 0xff, H[1] >> 16 & 0xff, H[1] >> 8 & 0xff, H[1] & 0xff, H[2] >> 24 & 0xff, H[2] >> 16 & 0xff, H[2] >> 8 & 0xff, H[2] & 0xff, H[3] >> 24 & 0xff, H[3] >> 16 & 0xff, H[3] >> 8 & 0xff, H[3] & 0xff, H[4] >> 24 & 0xff, H[4] >> 16 & 0xff, H[4] >> 8 & 0xff, H[4] & 0xff];
}

v35('v5', 0x50, sha1);

class TraceManager {
    constructor() {
        this.traceId = '';
        this.sessionId = '';
        this.pageLoadId = '';
        this.init();
    }
    init() {
        // 生成会话 ID，在整个会话期间保持不变
        this.sessionId = this.getOrCreateSessionId();
        // 生成页面加载 ID，每次页面加载时更新
        this.pageLoadId = this.generateTraceId();
        // 初始化 traceId 为页面加载 ID
        this.traceId = this.pageLoadId;
        // 页面卸载时保存会话信息
        window.addEventListener('beforeunload', () => {
            this.saveSessionData();
        });
    }
    getOrCreateSessionId() {
        // 尝试从 sessionStorage 获取会话 ID
        let sessionId = sessionStorage.getItem('errorMonitor_sessionId');
        // 如果不存在，创建新的会话 ID
        if (!sessionId) {
            sessionId = v4();
            sessionStorage.setItem('errorMonitor_sessionId', sessionId);
        }
        return sessionId;
    }
    saveSessionData() {
        // 保存当前会话数据
        sessionStorage.setItem('errorMonitor_sessionId', this.sessionId);
        sessionStorage.setItem('errorMonitor_lastActive', Date.now().toString());
    }
    generateTraceId() {
        return v4();
    }
    getTraceId() {
        return this.traceId;
    }
    setTraceId(traceId) {
        this.traceId = traceId;
    }
    getSessionId() {
        return this.sessionId;
    }
    getPageLoadId() {
        return this.pageLoadId;
    }
    getTraceInfo() {
        return {
            traceId: this.traceId,
            sessionId: this.sessionId,
            pageLoadId: this.pageLoadId
        };
    }
}

const defaultConfig = {
    reportConfig: {
        endpoint: '/api/error-report',
        appId: '',
        appVersion: '1.0.0',
        environment: 'production',
        maxRetryCount: 3,
        retryInterval: 3000,
        batchReport: true,
        batchSize: 10,
        batchInterval: 5000,
        useBeacon: true,
        reportLevel: 'error',
        sampleRate: 1.0
    },
    errorConfig: {
        ignoreErrors: [/^Network Error$/i, /^Script error\.?$/i],
        captureGlobalErrors: true,
        capturePromiseErrors: true,
        captureAjaxErrors: true,
        captureConsoleErrors: true,
        captureResourceErrors: true,
        maxErrorsPerMinute: 30
    },
    performanceConfig: {
        capturePageLoad: true,
        capturePaint: true,
        captureMemory: true,
        captureFrameRate: false,
        captureFirstContentfulPaint: true,
        captureLargestContentfulPaint: true,
        captureFirstInputDelay: true,
        captureCumulativeLayoutShift: true,
        resourceTiming: true,
        longTaskThreshold: 50
    },
    whiteScreenConfig: {
        enabled: true,
        timeout: 5000,
        minValidElements: 5,
        validSelectors: ['div', 'p', 'img', 'button', 'a'],
        checkInterval: 1000
    },
    fallbackConfig: {
        enabled: true,
        fallbackUrl: '/error',
        errorThreshold: 3,
        timeWindow: 60000
    },
    routeConfig: {
        enabled: false,
        captureParams: false,
        captureQuery: true,
        captureHash: false
    },
    stateConfig: {
        enabled: false,
        captureActions: true,
        captureMutations: true,
        captureState: true,
        stateSnapshotInterval: 30000,
        maxStateSize: 100000
    },
    sourceMapConfig: {
        enabled: true,
        uploadSourceMap: false,
        stripProjectRoot: '',
        includeSourceContent: false
    },
    debug: false
};

var index = {
    install(app, userConfig = {}) {
        const config = { ...defaultConfig, ...userConfig };
        // 初始化 TraceID 管理器
        const traceManager = new TraceManager();
        app.provide('traceManager', traceManager);
        // 初始化上报服务
        const reportService = new ReportService(config.reportConfig);
        app.provide('reportService', reportService);
        // 初始化 SourceMap 服务
        const sourceMapService = new SourceMapService(config.sourceMapConfig);
        app.provide('sourceMapService', sourceMapService);
        // 初始化错误监控
        const errorMonitor = new ErrorMonitor(app, reportService, sourceMapService, config.errorConfig);
        app.provide('errorMonitor', errorMonitor);
        // 初始化性能监控
        const performanceMonitor = new PerformanceMonitor(reportService, config.performanceConfig);
        app.provide('performanceMonitor', performanceMonitor);
        // 初始化白屏检测
        if (config.whiteScreenConfig.enabled) {
            const whiteScreenDetector = new WhiteScreenDetector(reportService, config.whiteScreenConfig);
            app.provide('whiteScreenDetector', whiteScreenDetector);
        }
        // 初始化 Fallback 服务
        if (config.fallbackConfig.enabled) {
            const fallbackService = new FallbackService(config.fallbackConfig);
            app.provide('fallbackService', fallbackService);
        }
        // 初始化路由监控
        if (config.routeConfig.enabled && config.routeConfig.router) {
            const routeMonitor = new RouteMonitor(config.routeConfig.router, reportService, traceManager, config.routeConfig);
            app.provide('routeMonitor', routeMonitor);
        }
        // 初始化状态管理监控
        if (config.stateConfig.enabled) {
            const stateMonitor = new StateMonitor(reportService, config.stateConfig);
            app.provide('stateMonitor', stateMonitor);
        }
        // 全局错误处理组件
        app.component('ErrorBoundary', {
        // 实现在 components/ErrorBoundary.ts
        });
        // 全局 mixin 用于组件级错误捕获
        app.mixin({
            errorCaptured(err, instance, info) {
                errorMonitor.handleComponentError(err, instance, info);
                return false; // 阻止错误继续传播
            }
        });
    }
};

exports.ErrorMonitor = ErrorMonitor;
exports.PerformanceMonitor = PerformanceMonitor;
exports.ReportService = ReportService;
exports.RouteMonitor = RouteMonitor;
exports.StateMonitor = StateMonitor;
exports["default"] = index;
//# sourceMappingURL=index.js.map
