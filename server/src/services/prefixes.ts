export function documentTitle(vendorName: string, originalName: string): string {
  const vendor = vendorName.trim();
  if (vendor.length > 0) {
    return vendor;
  }
  const original = originalName.trim();
  if (original.length > 0) {
    return original;
  }
  return "none";
}

export function prefixDocument(title: string, chunk: string): string {
  return `title: ${title} | text: ${chunk}`;
}

export function prefixQuery(query: string): string {
  return `task: question answering | query: ${query}`;
}
