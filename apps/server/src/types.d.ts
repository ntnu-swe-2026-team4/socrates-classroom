// esbuild(wrangler) 以 Text loader 讀 *.md（cloudflare.config.ts rules）
declare module "*.md" {
  const content: string;
  export default content;
}
declare module "*.sql" {
  const content: string;
  export default content;
}
declare module "*?raw" {
  const content: string;
  export default content;
}
