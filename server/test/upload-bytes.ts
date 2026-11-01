export function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
}

export function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

export function jpegBytes(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
}

export function htmlBytes(): Buffer {
  return Buffer.from("<html>not a pdf</html>");
}

export function pdfOfSize(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  Buffer.from("%PDF-1.4\n").copy(bytes);
  return bytes;
}
