# S16 选手从夯到拉

2026 英雄联盟全球总决赛 19 支队伍 95 名首发的 tier list，拖拽排档，排名存在浏览器本地。

## 打开

```bash
cd ~/self/worlds-tierlist && python3 -m http.server 4321
# 浏览器打开 http://localhost:4321
```

要用本地服务器打开，直接双击 html 时「保存为图片」会失败。

## 照片

来自 LoL Esports 官方 Flickr 的 Worlds 2026 相册（Swiss Stage / Play-Ins Asset Day 优先，其次 Features 和比赛日），
用 macOS Vision 检测人脸，挑脸最大的特写并按人脸位置裁切。每人最多 3 张，点照片切换。
369、Rookie、Labrov、POUT 本届相册暂无单人照，用的是 lolesports 2026 赛季官方头像（卡片标「旧照」）。

重新生成数据：先把相册 JSON（`set_*.json`）和 lolesports `teams.json` 放到一个目录，再运行

```bash
python -m venv venv && venv/bin/pip install pyobjc-framework-Vision pyobjc-framework-Quartz
venv/bin/python scripts/build_data.py <目录>
```
