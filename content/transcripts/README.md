# 逐字稿

作者手动维护的直播逐字稿。站点只读渲染，不做站内编辑；编辑器是独立项目的事。

## 放哪里

```text
content/transcripts/<datasetId>/<videoId>.md
```

- `<datasetId>` 必须是 `data-sources.json` 里的 id（例如 `nonoka`）。
- `<videoId>` 是 YouTube video id，也是关联场次的唯一键；文件名可以随便取，但建议用 `<videoId>.md`。
- 以 `_` 或 `.` 开头的文件（例如 `.template.md`）是模板 / 草稿，不参与发布。

## 格式

```markdown
---
videoId: W0bKqP-Eyj4
date: 2026-10-29
title: 【歌枠】ののうた♪さむい♪テーマなし♪
members: [nonoka]
tags: [歌枠, shorts]
summary: 一场边唱边聊的短直播。
tweets: []
---

## 开场

[00:00:12] 大家好，今天想聊聊……
```

- 必填：`videoId`。其余字段缺省时页面会退回 videoId / 空值。
- `members` / `tags` / `tweets` 用行内数组 `[a, b]`；字符串里有冒号或 `#` 时用双引号包起来。
- 行首的 `[12:34]` / `[1:02:03]` 会自动变成指向原视频对应秒数的链接；代码块里的不动。
- 标题用 `##` / `###`，会生成右侧目录；`#` 一级标题也会按二级渲染，避免和页面结构打架。

## 命令

```bash
# 从模板建一篇，date / title 自动从 manifest 带出
bun run transcript:new W0bKqP-Eyj4 --dataset nonoka

# 导入已经写好的 Markdown（frontmatter 缺 videoId 时可用 --video-id 指定）
bun run transcript:import "D:/messages/.../2026-10-13_ライブ振り返り.md" --dataset nonoka

# 校验 + 发布到对象存储；加 --no-upload 只校验
bun run publish:transcripts
```

发布产物：

```text
<base>/transcripts/index.json
<base>/<datasetId>/transcripts/<videoId>.json
```

页面运行时远端优先，读不到时回退到构建期的 Markdown 快照。单篇失败（缺 videoId、未知
dataset、重复 videoId）会记日志并跳过，不阻塞其他稿；修好后重新运行即可增量补传。

## 注意

- 一篇稿只属于一个 dataset / 一场直播；重复 videoId 会让发布返回非零退出码。
- 图片暂按相对路径引用，发布脚本不会上传图片资源（后续需要时再扩展）。
- 不要在稿里放大段抓取原文；这里是作者整理的正文，不是原始弹幕。
