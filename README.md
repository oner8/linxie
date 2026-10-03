# 临写 · Linxie

手机优先的汉字临写工具。输入 1–3 个汉字，在屏幕上放大查看，在纸上练习。

## 功能

- 逐字放大、左右滑动切字和全部展示
- 作文格、田字格、米字格、回宫格、回田格、回米格
- 八款内置字体，按输入文字生成所需的 WOFF2 子集
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

字体原件不在仓库中。将 `fonts/catalog.json` 所列文件放入 `fonts/` 后运行准备脚本；脚本会校验文件指纹并将处理结果写入被忽略的 `data/fonts/`。

## 验证

```sh
PYTHON_BIN="$PWD/.venv/bin/python" npm test
npm run build
BASE_URL=http://127.0.0.1:3000 npm run test:e2e
```

浏览器测试前需要安装 Chromium 并启动生产或开发服务。

## Docker

```sh
docker build -t linxie:0.1.0 .
docker compose up -d --wait
curl --fail http://127.0.0.1:3100/api/health
```

镜像不包含字体文件。Compose 通过 `LINXIE_FONT_DIR` 只读挂载字体资源，并通过 `LINXIE_CACHE_DIR` 持久化生成的字体子集；实际环境变量写入不受 Git 跟踪的 `.env`。
