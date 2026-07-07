// esbuild bundles .ttf imports as base64 strings (--loader:.ttf=base64),
// consumed by jsPDF's addFileToVFS for font embedding.
declare module "*.ttf" {
  const base64: string
  export default base64
}
