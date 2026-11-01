/** X（Twitter）的话题页与个人主页地址。 */
export const X_HASHTAG_URL = "https://x.com/hashtag/";
export const X_PROFILE_URL = "https://x.com/";

const URL_TOKEN = /(https?:\/\/\S+)/u;

/**
 * 话题标签允许任意语言；提及只允许 ASCII 手柄，且不能紧贴文字（避开邮箱里的 `@`）。
 * 前面的 `#`、`&` 也排除，避免把 `C#`、`##标题` 误当成标签。
 */
const X_TOKEN =
  /(?<![\p{L}\p{N}_#&])#(?<tag>[\p{L}\p{N}_]+)|(?<![\p{L}\p{N}_.-])@(?<handle>[A-Za-z0-9_]{1,15})(?![\p{L}\p{N}_])/gu;

export function xHashtagUrl(tag: string): string {
  return `${X_HASHTAG_URL}${encodeURIComponent(tag)}`;
}

/** 判断链接文字是不是本模块生成的 `#标签` / `@提及`，用来和普通外链区分样式。 */
export function isXTokenLabel(label: string): boolean {
  return label.startsWith("#") || label.startsWith("@");
}

/**
 * 把简介这类纯文本里的 `#标签`、`@提及` 改写成 Markdown 链接，指向 X 的话题页与主页。
 * 已经写在 URL 里的 `#` / `@` 保持原样。
 */
export function linkifyX(text: string): string {
  return text
    .split(URL_TOKEN)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(X_TOKEN, (_match, tag?: string, handle?: string) =>
            tag ? `[#${tag}](${xHashtagUrl(tag)})` : `[@${handle}](${X_PROFILE_URL}${handle})`,
          ),
    )
    .join("");
}
