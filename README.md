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

当前发布镜像为 `ghcr.io/oner8/linxie:0.1.2`，平台为 `linux/amd64`。下面以宿主机 `/srv/linxie/` 为部署目录，使用 Docker Compose v2。

### 首次部署

将仓库中的 `docker-compose.yaml` 放入部署目录，把准备脚本生成的 `data/fonts/` 内容复制到该目录下的 `data/fonts/`。镜像不包含字体；资源必须包括 `manifest.json`、各字体的 `.json` 和 `.ttf`，不能只放字体原件。

按实际情况直接修改 `docker-compose.yaml` 中的镜像、宿主机端口和两条挂载的宿主机目录，默认如下：

```yaml
image: ghcr.io/oner8/linxie:0.1.2
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

已有 `.env` 部署需把 `LINXIE_IMAGE`、`LINXIE_PORT`、`LINXIE_FONT_DIR` 和 `LINXIE_CACHE_DIR` 的实际值填入上述 YAML 字段。源码根目录的本地 `compose.yaml` 仍支持这些 `LINXIE_*` 覆盖，可参考 `.env.example`。

如需自己构建，在源码根目录执行以下命令，并将部署 YAML 的 `image` 改为 `linxie:0.1.2`；使用本地镜像时跳过更新流程中的 `pull`：

```sh
docker build -t linxie:0.1.2 .
```

### 缓存权限与验证

容器入口以 root 初始化缓存目录本身的所有者为 `1000:1000`，并确保所有者可读、可写、可遍历，随后通过 `setpriv` 降权为 `node` 并启用 `no-new-privileges`。若在 Compose 中覆盖为非 root 用户，入口只检查缓存可写，不修改所有者；需预先确保该用户有写权限。初始化失败会明确报错并停止启动。

默认 `docker exec` 使用 root，检查应用权限时须显式指定 `1000:1000`：

```sh
cd /srv/linxie
docker compose -f docker-compose.yaml exec --user 1000:1000 app sh -c 'id; ls -ld "$FONT_CACHE_DIR"; test -w "$FONT_CACHE_DIR"'
docker compose -f docker-compose.yaml logs --tail 50 app
```

找不到配置文件时进入部署目录，或在 `-f` 后填写绝对路径。缓存初始化报错或出现 `font_cache_write_failed` 时，核对挂载路径、写权限、SELinux 标签和磁盘空间。`/api/health` 和容器 `healthy` 只验证基础字体资源，不测试缓存写入。

第一次生成某款字体、某组汉字时，日志 `hit:false` 和响应头 `X-Font-Cache: MISS` 是正常的，生成后应有缓存文件。相同字体 ID、版本及汉字请求再次到达服务器时，应为 `hit:true` / `X-Font-Cache: HIT`；浏览器直接使用自身缓存时不会产生新的服务端日志。重启容器后缓存仍应保留。

### 更新与回退

更新前记录旧镜像标签并备份部署 YAML 和字体清单。将 YAML 的 `image` 改为需要的 GHCR 发布标签后执行：

```sh
cd /srv/linxie
docker compose -f docker-compose.yaml pull
docker compose -f docker-compose.yaml up -d --force-recreate --wait
```

更改镜像、端口或挂载目录后，也要使用 `up -d --force-recreate --wait` 重新创建容器；`restart` 不会应用这些修改。回退时恢复旧镜像标签和必要的字体清单，执行相同更新命令，并验证健康与缓存；无需删除字体或清空缓存。

### 运行时增加字体

将静态 `.ttf` 或 `.otf` 原始字体复制到部署 YAML 中挂载至 `/app/data/fonts` 的宿主机目录（默认 `./data/fonts/`），刷新页面即可在内置字体列表中选择。无需修改 `fonts/catalog.json`、运行准备脚本、重启容器或重新构建镜像。

文件名去掉扩展名后作为展示名称，例如 `某某楷书.ttf`；名称中按“行楷、楷书、行书”的顺序识别书体，其余标为“其他”。同内容文件只显示一次；移除文件后刷新页面即从列表移除，替换文件会生成新的字体版本。

每款新增字体最多 30 MiB。符号链接、字体集合、可变字体及无法读取的文件会被跳过并记录服务日志，不影响基础字体。建议先复制到非字体扩展名的临时文件，复制完成后再重命名为 `.ttf` 或 `.otf`。新增字体只支持其实际包含的汉字；需要特殊修复的字体仍应加入 `fonts/catalog.json`，确认指纹及修复策略后运行准备脚本。
