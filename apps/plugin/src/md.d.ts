declare module '*.md' {
  /** esbuild text loader 内联的 markdown 文本 */
  const content: string
  export default content
}
