const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XHTML_NAMESPACE = "http://www.w3.org/1999/xlink";

const INLINE_STYLE_PROPERTIES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "opacity",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "paint-order",
  "shape-rendering",
] as const;

const SVG_FALLBACK_SIZE = { height: 360, width: 640 };

interface Size {
  height: number;
  width: number;
}

function svgSize(svg: SVGSVGElement): Size {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox?.baseVal;
  const width = Math.round(rect.width || viewBox?.width || Number(svg.getAttribute("width")) || 0);
  const height = Math.round(rect.height || viewBox?.height || Number(svg.getAttribute("height")) || 0);

  if (width > 0 && height > 0) return { height, width };

  return SVG_FALLBACK_SIZE;
}

function inlinePresentationStyles(source: SVGSVGElement, target: SVGSVGElement): void {
  const sourceElements: Element[] = [source, ...Array.from(source.querySelectorAll("*"))];
  const targetElements: Element[] = [target, ...Array.from(target.querySelectorAll("*"))];

  if (sourceElements.length !== targetElements.length) return;

  for (let index = 0; index < sourceElements.length; index += 1) {
    const sourceElement = sourceElements[index];
    const targetElement = targetElements[index];

    if (!(targetElement instanceof SVGElement)) continue;

    const computed = window.getComputedStyle(sourceElement);

    for (const property of INLINE_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) targetElement.style.setProperty(property, value);
    }

    const visibility = computed.getPropertyValue("visibility");
    if (visibility && visibility !== "visible") {
      targetElement.style.setProperty("visibility", visibility);
    }

    const display = computed.getPropertyValue("display");
    if (display === "none") targetElement.style.setProperty("display", display);
  }
}

/**
 * 将页面内联的图表 SVG 序列化成可独立打开的 SVG 文件。
 * 计算样式逐元素写入克隆节点的 style，避免导出后丢失配色与字体。
 */
export function serializeSvg(svg: SVGSVGElement): Blob {
  if (!svg) {
    throw new Error("找不到图表 SVG，无法导出。");
  }

  const { height, width } = svgSize(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;

  clone.setAttribute("xmlns", SVG_NAMESPACE);
  clone.setAttribute("xmlns:xlink", XHTML_NAMESPACE);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  inlinePresentationStyles(svg, clone);

  for (const ignored of Array.from(clone.querySelectorAll('[data-export="ignore"]'))) {
    ignored.remove();
  }

  const markup = new XMLSerializer().serializeToString(clone);

  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${markup}`], {
    type: "image/svg+xml;charset=utf-8",
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.download = filename;
  link.href = url;
  link.rel = "noopener";
  link.style.display = "none";

  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSvg(svg: SVGSVGElement, filenameBase: string): void {
  downloadBlob(serializeSvg(svg), `${filenameBase}.svg`);
}

function resolveBackground(background?: string): string {
  if (background) return background;
  if (typeof document === "undefined") return "#ffffff";

  const bodyBackground = window.getComputedStyle(document.body).backgroundColor;

  if (!bodyBackground || bodyBackground === "transparent" || bodyBackground === "rgba(0, 0, 0, 0)") {
    return "#ffffff";
  }

  return bodyBackground;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图表 SVG 解码失败，无法生成 PNG。"));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("浏览器无法编码 PNG，导出失败。"));
    }, "image/png");
  });
}

export async function exportPng(
  svg: SVGSVGElement,
  filenameBase: string,
  background?: string,
): Promise<void> {
  const { height, width } = svgSize(svg);
  const url = URL.createObjectURL(serializeSvg(svg));

  try {
    const image = await loadImage(url);
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持 Canvas 2D，无法导出 PNG。");

    context.fillStyle = resolveBackground(background);
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await canvasToBlob(canvas);
    downloadBlob(blob, `${filenameBase}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function safeFilename(title: string): string {
  const cleaned = (title ?? "")
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");

  return cleaned || "chart";
}
