import typescript from '@rollup/plugin-typescript'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import terser from '@rollup/plugin-terser'
import pkg from './package.json'

export default {
  input: 'src/index.ts',
  output: [
    {
      file: pkg.main,
      format: 'cjs',
      sourcemap: true,
      exports: 'named', // Add this line to fix the named exports warning
    },
    {
      file: pkg.module,
      format: 'es',
      sourcemap: true,
      exports: 'named', // Add this line to fix the named exports warning
    },
    {
      file: 'dist/index.min.js',
      format: 'iife',
      name: 'Vue3ErrorMonitor',
      plugins: [terser()],
      sourcemap: true,
      globals: {
        vue: 'Vue',
        'vue-router': 'VueRouter',
        stackframe: 'StackFrame',
        'stack-generator': 'StackGenerator',
      },
      exports: 'named', // Add this line to fix the named exports warning
    },
  ],
  external: [
    ...Object.keys(pkg.peerDependencies || {}),
    'stackframe',
    'stack-generator',
  ],
  plugins: [
    typescript({
      tsconfig: './tsconfig.json',
      declaration: true,
      declarationDir: './dist',  // 修改为直接输出到 dist 目录
      outDir: './dist'
    }),
    nodeResolve({
      extensions: ['.js', '.ts', '.d.ts'],
    }),
    commonjs({
      include: 'node_modules/**',
      extensions: ['.js', '.ts'],
    }),
  ],
}
