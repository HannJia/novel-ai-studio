// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { KNOWLEDGE_IMPORT_LIMITS, readKnowledgeFile, validateKnowledgeZip } from './knowledgeImport'
// Vitest resolves Mammoth's Node entry; production Vite uses its browser map.
vi.mock('mammoth', async original => {
  const module = await original<typeof import('mammoth')>()
  return { default: { extractRawText: ({ arrayBuffer }: { arrayBuffer: ArrayBuffer }) => module.extractRawText({ buffer: Buffer.from(arrayBuffer) }) } }
})

function epub() {
  const zip = new JSZip()
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
  zip.file('OEBPS/content.opf', '<package><manifest><item id="first" href="z.xhtml"/><item id="second" href="a.xhtml"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>')
  zip.file('OEBPS/z.xhtml', '<html><head><title>不应重复的标题</title><script>不应导入的脚本</script></head><body><p>第一章：他打开了信。</p></body></html>')
  zip.file('OEBPS/a.xhtml', '<html><body><p>第二章：信中写着答案。</p></body></html>')
  return zip
}
describe('bounded knowledge imports', () => {
  it('reads EPUB in OPF spine order instead of lexical filename order', async () => {
    const buffer = await epub().generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
    const result = await readKnowledgeFile(new File([buffer], 'spine.epub'))
    expect(result.indexOf('第一章')).toBeLessThan(result.indexOf('第二章'))
    expect(result).not.toContain('不应')
  })
  it('rejects missing chapter references and malicious paths', async () => {
    const zip = epub()
    zip.file('OEBPS/content.opf', '<package><manifest><item id="first" href="../../outside.xhtml"/></manifest><spine><itemref idref="first"/></spine></package>')
    await expect(readKnowledgeFile(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'invalid.epub'))).rejects.toThrow('路径越界')
  })
  it('checks compressed file size, declared expansion, and malformed ZIP64 before extraction', async () => {
    await expect(readKnowledgeFile({ name: 'large.docx', size: KNOWLEDGE_IMPORT_LIMITS.fileBytes + 1 } as File)).rejects.toThrow('25 MB')
    const buffer = await epub().generateAsync({ type: 'arraybuffer' })
    const view = new DataView(buffer)
    const central = view.getUint32(buffer.byteLength - 6, true)
    view.setUint32(central + 24, KNOWLEDGE_IMPORT_LIMITS.entryBytes + 1, true)
    expect(() => validateKnowledgeZip(buffer)).toThrow('解压内容超过')
    view.setUint32(central + 24, 0xffffffff, true)
    expect(() => validateKnowledgeZip(buffer)).toThrow('ZIP64')
  })
  it('continues to read Word text after the XML dependency security update', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>父亲寄来一封信。</w:t></w:r></w:p></w:body></w:document>')
    expect(await readKnowledgeFile(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'sample.docx'))).toContain('父亲寄来一封信')
  })
  it('cleans up the PDF worker when its page limit is exceeded', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined)
    vi.doMock('pdfjs-dist', () => ({
      GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 1001 }), destroy }),
    }))
    await expect(readKnowledgeFile(new File(['mock'], 'too-many-pages.pdf'))).rejects.toThrow('1000 页')
    expect(destroy).toHaveBeenCalled()
  })
})
