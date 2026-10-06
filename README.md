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
先向维护者领取 `linxie-fonts-0.1.2.tar.gz`，放到仓库根目录并解压：

```sh
tar -xzf linxie-fonts-0.1.2.tar.gz -C .
npm ci
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
PYTHON_BIN="$PWD/.venv/bin/python" npm run dev
```

字体原件不在仓库中。若持有 `fonts/catalog.json` 所列原件，也可将其放入 `fonts/`，运行 `.venv/bin/python scripts/prepare_fonts.py` 生成 `data/fonts/`。

## 验证

```sh
npm run build
```

测试文件由维护者在本地保管，不随仓库发布。

## Docker

部署示例使用 `ghcr.io/oner8/linxie:latest`，平台为 `linux/amd64`。下面以宿主机 `/srv/linxie/` 为部署目录，使用 Docker Compose v2。

### 首次部署

克隆仓库后，向维护者私下领取 `linxie-fonts-0.1.2.tar.gz`，放到包含 `docker-compose.yaml` 的部署目录并解压：

```sh
cd /srv/linxie
tar -xzf linxie-fonts-0.1.2.tar.gz -C .
```

解压后得到 `data/fonts/`，内含 `manifest.json` 和八组 `.json`、`.ttf`。字体包不在 GitHub 或 GHCR 中；镜像不包含字体。若修改字体挂载路径，请将宿主机路径指向解压出的 `data/fonts/`。

按实际情况直接修改 `docker-compose.yaml` 中的镜像、宿主机端口和两条挂载的宿主机目录，默认如下：

```yaml
image: ghcr.io/oner8/linxie:latest
ports:
  - "127.0.0.1:3100:3000"
volumes:
  - ./data/fonts:/app/data/fonts:ro,Z
  - ./data/cache:/app/data/cache:Z
```

保留字体挂载的 `ro` 和两条挂载的 `:Z`。字体目录需对 UID `1000` 可读、可遍历（通常目录 `755`、文件 `644`）；缓存目录由容器入口初始化，无需手动 `chown`。`:Z` 为本站独立目录设置 SELinux 标签，请使用本站专用目录。

配置完成后启动，无需创建 `.env`：

```sh
cd /srv/linxie
docker compose -f docker-compose.yaml up -d --wait
```

端口默认只监听 `127.0.0.1`，通过 HTTPS 反向代理访问。更改宿主机端口后同步修改反向代理端口；宝塔配置示例见 `deploy/nginx-location.conf`，反代应覆盖 `X-Real-IP`，与 `TRUST_PROXY=1` 配合。

已有 `.env` 部署会沿用 `LINXIE_FONT_DIR` 和 `LINXIE_CACHE_DIR`；镜像和宿主机端口以 YAML 为准。源码根目录的本地 `compose.yaml` 仍支持全部 `LINXIE_*` 覆盖，可参考 `.env.example`。

如需自己构建，在源码根目录执行以下命令，并将部署 YAML 的 `image` 改为 `linxie:0.1.2`：

```sh
docker build -t linxie:0.1.2 .
```

### 运行时增加字体

将静态 `.ttf` 或 `.otf` 原始字体复制到部署 YAML 中挂载至 `/app/data/fonts` 的宿主机目录（默认 `./data/fonts/`），刷新页面即可在内置字体列表中选择。无需修改 `fonts/catalog.json`、运行准备脚本、重启容器或重新构建镜像。

文件名去掉扩展名后作为展示名称，例如 `某某楷书.ttf`；名称中按“行楷、楷书、行书”的顺序识别书体，其余标为“其他”。同内容文件只显示一次；移除文件后刷新页面即从列表移除，替换文件会生成新的字体版本。

每款新增字体最多 30 MiB。符号链接、字体集合、可变字体及无法读取的文件会被跳过并记录服务日志，不影响基础字体。建议先复制到非字体扩展名的临时文件，复制完成后再重命名为 `.ttf` 或 `.otf`。新增字体只支持其实际包含的汉字；需要特殊修复的字体仍应加入 `fonts/catalog.json`，确认指纹及修复策略后运行准备脚本。
