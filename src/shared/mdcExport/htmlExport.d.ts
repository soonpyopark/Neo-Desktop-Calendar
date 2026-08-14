export function buildHtmlDocument(
  layout: {
    layout?: string
    title?: string
    imageSrcs?: Map<string, string> | Record<string, string>
    [key: string]: unknown
  },
  imageSrcs?: Map<string, string> | Record<string, string>
): string
