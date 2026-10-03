# 临写 · Linxie

手机优先的汉字临写工具。输入 1–3 个汉字，在屏幕上放大查看，在纸上练习。

## 功能

- 逐字放大、左右滑动切字和全部展示
- 作文格、田字格、米字格、回宫格、回田格、回米格
- 八款基础字体及运行时新增字体，按输入文字生成所需的 WOFF2 子集
- 导入本机 TTF、OTF、WOFF、WOFF2；文件只保存在浏览器 IndexedDB
- 字形大小、格线深浅、线条颜色、描红颜色及六组主题
- 标准楷书笔顺动画，播放结束后恢复所选范字
- 专注模式及浏览器支持时保持屏幕常亮

## 技术

项目使用 Next.js、React、TypeScript、Tailwind CSS 和 shadcn/ui。服务端通过 FontTools 与 Brotli 按字生成字体子集，使用磁盘缓存，不依赖数据库。

浏览器设置保存在 localStorage；用户导入的字体保存在 IndexedDB，不会上传到服务器。内置字体原件、处理结果、缓存、环境文件和内部文档不纳入 Git。

## 本地开发

需要 Node.js 24、npm 和 Python 3.10+。

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/prepare_fonts.py
PYTHON_BIN="$PWD/.venv/bin/python" npm run dev
```

字体原件不在仓库中。将 `fonts/catalog.json` 所列文件放入 `fonts/` 后运行准备脚本；脚本会校验文件指纹并将处理结果写入 `data/fonts/`。

## 验证

```sh
PYTHON_BIN="$PWD/.venv/bin/python" npm test
npm run build
BASE_URL=http://127.0.0.1:3000 npm run test:e2e
```

浏览器测试前需要安装 Chromium 并启动生产或开发服务。

## Docker

```sh
docker build -t linxie:0.1.1 .
docker compose up -d --wait
curl --fail http://127.0.0.1:3100/api/health
```

镜像不包含字体文件。Compose 通过 `LINXIE_FONT_DIR` 只读挂载字体资源，并通过 `LINXIE_CACHE_DIR` 持久化生成的字体子集；实际环境变量写入不受 Git 跟踪的 `.env`。

### 运行时增加字体

将静态 `.ttf` 或 `.otf` 原始字体复制到宿主机的 `LINXIE_FONT_DIR`（默认 `data/fonts/`）目录，刷新页面即可在内置字体列表中选择。无需修改 `fonts/catalog.json`、运行准备脚本、重启容器或重新构建镜像。

文件名去掉扩展名后作为展示名称，例如 `某某楷书.ttf`；名称中按“行楷、楷书、行书”的顺序识别书体，其余标为“其他”。同内容文件只显示一次；移除文件后刷新页面即从列表移除，替换文件会生成新的字体版本。

每款新增字体最多 30 MiB。符号链接、字体集合、可变字体及无法读取的文件会被跳过并记录服务日志，不影响基础字体。建议先复制到非字体扩展名的临时文件，复制完成后再重命名为 `.ttf` 或 `.otf`。新增字体只支持其实际包含的汉字；需要特殊修复的字体仍应加入 `fonts/catalog.json`，确认指纹及修复策略后运行准备脚本。
