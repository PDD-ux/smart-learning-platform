export function minimalPdfFixture(): Buffer {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream='BT /F1 12 Tf 50 700 Td (First page) Tj ET\nBT /F1 12 Tf 50 680 Td (Second block) Tj ET';
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  let source='%PDF-1.4\n';const offsets=[0];
  objects.forEach((object,index):void=>{offsets.push(Buffer.byteLength(source));source+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(source);source+=`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((offset)=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(source);
}
