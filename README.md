# 临写 · Linxie

手机优先的汉字临写工具。输入 1–3 个汉字，在屏幕上放大查看，在纸上练习。

## 功能

- 逐字放大、左右滑动切字和全部展示
- 作文格、田字格、米字格、回宫格、回田格、回米格
- 八款基础字体及运行时新增字体，按输入文字生成所需的 WOFF2 子集
- 导入本机 TTF、OTF、WOFF、WOFF2；文件只保存在浏览器 IndexedDB
- 字形大小、格线深浅、线条颜色、描红颜色及六组主题
- 标准楷书笔顺动画，播放结束后恢复所选范字
- 示范视频：逐字循环播放该字的书写过程，画面裁到田字格内
- 可选的自建切片：把每个字预先切成独立 MP4 放到自己的服务器，播放不再经本服务中转
- 专注模式及浏览器支持时保持屏幕常亮

## 技术

项目使用 Next.js、React、TypeScript、Tailwind CSS 和 shadcn/ui。服务端通过 FontTools 与 Brotli 按字生成字体子集，使用磁盘缓存，不依赖数据库。

浏览器设置保存在 localStorage；用户导入的字体保存在 IndexedDB，不会上传到服务器。内置字体原件、处理结果、缓存、环境文件和内部文档不纳入 Git。

示范视频取自 B 站「全网最全 行楷 7000 字逐字示范」，按 B 站要求经服务端代理转发（直连 CDN 会被 403）。每个字的时间点与裁切框已整理为 `data/videos.json`。接口返回 `no-store`，避免浏览器沿用旧片段。

一次播放要经本服务从 B 站取回整集（十几 MB），而片段只有几秒。配置 `LINXIE_CLIPS_BASE` 后改为从自己的地址取预切好的 MP4，单次播放降到几百 KB，本服务也不再承担视频流量。两种模式全局二选一，不混用：混用时播放器会把已从片段起点开始的文件当成还要跳到该字的时间点，落到文件末尾之外。

## 示范视频数据

视频时间点和裁切框存放在 `data/videos.json`，随仓库分发，克隆即可用。文件约 91 KB，按「源 → 集 → 字」组织：

```json
{ "sources": [ { "bvid": "BV...", "parts": {
  "10": { "cid": 38107352139, "cx": 49.6, "cy": 48.2, "half": 46.3,
          "chars": { "永": [81, 91] } } } } ] }
```

- `cx / cy / half` 是这一集田字格在画面中的位置，按集存一份
- `chars` 存该字的起止秒数；`[start, end, 1]` 表示没有逐字时间点时整集播放
- `sources` 是有序数组，同一字出现在多个合集时靠前者优先

该文件同时打进镜像，容器直接运行即可用。挂载同名文件可覆盖镜像内的版本（用于换上更新的标注），也可用 `LINXIE_VIDEO_DATA` 指定路径。文件缺失或损坏时应用照常运行，只是「视频演示」按钮不可用。

维护这份数据用 `tools/annotate/`（裁切框 + 时间点合一的本地工具），详见 [tools/annotate/README.md](tools/annotate/README.md)。

## 预切片（可选）

不配置 `LINXIE_CLIPS_BASE` 时，视频由本服务从 B 站代理转发。想省掉这份流量和跨境延迟，可以把每个字的片段预先切好放到自己的服务器。

```sh
# 1. 生成片段（copy 模式，无损且不耗 CPU）
BILIBILI_SESSDATA=... node scripts/export-clips.mjs --out ./clips

# 2. 把 clips/ 整个目录上传到自己的服务器，能通过 HTTPS 直链访问

# 3. 在 .env 里填上访问前缀（结尾不要加斜杠）
LINXIE_CLIPS_BASE=https://你的域名:端口/linxie
```

生成的文件按 `{cid}-{起}-{止}.mp4` 命名，与前端请求的路径一一对应，可直接静态托管。片段保留原始 16:9 画面，裁到田字格仍由前端按 `cx/cy/half` 完成，因此之后调整裁切框不需要重切。

常用参数：

| 参数 | 作用 |
|---|---|
| `--jobs N` | 同时下载几个分P（默认 4），网络慢时可调大 |
| `--chars 永一` | 只导出这几个字，便于先试样 |
| `--limit N` | 只导前 N 个 |
| `--crf 28` | 重编码而非直接复制；源片已是约 437 kb/s，降低码率会更小但笔画变糊 |
| `--force` | 覆盖已存在的文件（默认跳过，可断点续传） |

托管端需要支持 Range 请求（拖动进度用），并允许浏览器直连。没有 CORS 要求：播放器不读像素，只解码显示。

切片地址不可达、404 或证书错误时，播放器自动回退到代理路径，功能不中断；但整集代理没有逐字时间点可用，所以回退后播的是整集。

`clips/` 目录不要提交到仓库。

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

示范视频数据已包含在镜像中，无需额外准备。若要用比镜像更新的标注，在 `docker-compose.yaml` 的 volumes 里取消 `videos.json` 那行的注释并指向宿主机文件。

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

仓库里有三个部署相关文件，用途不同：

| 文件 | 用途 |
| --- | --- |
| `docker-compose.yaml` | 面向部署：拉取 `ghcr.io/oner8/linxie:latest`，端口写死 3100 |
| `compose.yaml` | 面向本机构建：镜像默认 `linxie:0.1.3`，端口和路径都可用 `.env` 覆盖 |
| `Dockerfile` | 构建镜像本身 |

两个 YAML 的服务定义一致（三条挂载 + `BILIBILI_SESSDATA`），只在镜像来源和可覆盖项上不同。同目录同时存在时 Compose 优先读 `compose.yaml`；部署时用 `-f docker-compose.yaml` 明确指定。

已有 `.env` 部署会沿用 `LINXIE_FONT_DIR` 和 `LINXIE_CACHE_DIR`；镜像和宿主机端口以 YAML 为准。源码根目录的本地 `compose.yaml` 支持全部 `LINXIE_*` 覆盖，可参考 `.env.example`。

示范视频默认按未登录处理，最高 480p。在 `.env` 中设置 `BILIBILI_SESSDATA`（B 站登录后的 Cookie 值，仅用于提高画质），两个 YAML 都会把它传入容器。Cookie 只存在宿主机，不写入镜像或仓库。

如需自己构建，在源码根目录执行以下命令，并将部署 YAML 的 `image` 改为 `linxie:0.1.3`：

```sh
docker build -t linxie:0.1.3 .
```

### 运行时增加字体

将静态 `.ttf` 或 `.otf` 原始字体复制到部署 YAML 中挂载至 `/app/data/fonts` 的宿主机目录（默认 `./data/fonts/`），刷新页面即可在内置字体列表中选择。无需修改 `fonts/catalog.json`、运行准备脚本、重启容器或重新构建镜像。

文件名去掉扩展名后作为展示名称，例如 `某某楷书.ttf`；名称中按“行楷、楷书、行书”的顺序识别书体，其余标为“其他”。同内容文件只显示一次；移除文件后刷新页面即从列表移除，替换文件会生成新的字体版本。

每款新增字体最多 30 MiB。符号链接、字体集合、可变字体及无法读取的文件会被跳过并记录服务日志，不影响基础字体。建议先复制到非字体扩展名的临时文件，复制完成后再重命名为 `.ttf` 或 `.otf`。新增字体只支持其实际包含的汉字；需要特殊修复的字体仍应加入 `fonts/catalog.json`，确认指纹及修复策略后运行准备脚本。
