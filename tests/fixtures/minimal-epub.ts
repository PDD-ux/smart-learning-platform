import { crc32, deflateRawSync } from 'node:zlib';
export type ZipEntry = { name: string; value: string | Buffer; compress?: boolean; flags?: number; originalSize?: number; externalAttributes?: number };
/** Independent standard ZIP fixture writer; no product ZIP or XML parser is used. */
export function zipFixture(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), value = Buffer.isBuffer(entry.value) ? entry.value : Buffer.from(entry.value), compressed = entry.compress ? deflateRawSync(value) : value;
    const header = Buffer.alloc(30), directory = Buffer.alloc(46), checksum = crc32(value), size = entry.originalSize ?? value.length, flags = entry.flags ?? 0x800;
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(entry.compress ? 8 : 0, 8); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(size, 22); header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x314, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(flags, 8); directory.writeUInt16LE(entry.compress ? 8 : 0, 10); directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(size, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(entry.externalAttributes ?? 0, 38); directory.writeUInt32LE(offset, 42);
    local.push(header, name, compressed); central.push(directory, name); offset += header.length + name.length + compressed.length;
  }
  const body = Buffer.concat(local), cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cd, end]);
}
export function epubEntries(ncx = false): ZipEntry[] {
  return [
    { name: 'mimetype', value: 'application/epub+zip' },
    { name: 'META-INF/container.xml', value: '<container><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OPS/package.opf', value: '<package><manifest><item id="second" href="b.xhtml" media-type="application/xhtml+xml"/><item id="first" href="a.xhtml" media-type="application/xhtml+xml"/>' + (ncx ? '<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>') + '</manifest><spine' + (ncx ? ' toc="toc"' : '') + '><itemref idref="first"/><itemref idref="second"/></spine></package>' },
    { name: 'OPS/a.xhtml', compress: true, value: '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title><style>.x{color:red}</style></head><body><h1 id="start">学习目标</h1>' + Array.from({ length: 24 }, (_, index): string => '<p id="p' + index + '">原文第' + (index + 1) + '段：先理解课程依据，再记录自己的问题。</p>').join('') + '<script>throw new Error("不执行脚本")</script><iframe src="https://invalid.example/"/><img src="https://invalid.example/image"/><p hidden="hidden">隐藏正文不展示</p></body></html>' },
    { name: 'OPS/b.xhtml', value: '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>回顾方法</h1><p>回顾应根据实际记录。</p><p>不能把计划当作已经完成。</p></body></html>' },
    ncx ? { name: 'OPS/toc.ncx', value: '<ncx><navMap><navPoint><navLabel><text>原书第一章</text></navLabel><content src="a.xhtml#start"/></navPoint><navPoint><navLabel><text>原书第二章</text></navLabel><content src="b.xhtml"/></navPoint></navMap></ncx>' } : { name: 'OPS/nav.xhtml', value: '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="b.xhtml">原书第二章</a></li><li><a href="a.xhtml#p12">深入理解</a></li><li><a href="a.xhtml#start">原书第一章</a></li></ol></nav></body></html>' },
  ];
}
export function minimalEpub(ncx = false): Buffer { return zipFixture(epubEntries(ncx)); }
