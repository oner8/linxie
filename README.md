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

当前发布镜像为 `ghcr.io/oner8/linxie:0.1.1`，平台为 `linux/amd64`。下面以宿主机 `/srv/linxie/` 为例，使用 Docker Compose v2；目录初始化及权限修复命令以宿主机 root 执行，普通用户需使用 `sudo`。

### 首次部署

部署需要仓库中的 `docker-compose.yaml`、`.env.example` 和准备脚本生成的 `data/fonts/` 内容。镜像不包含字体文件，字体资源必须包含 `manifest.json`、各字体的 `.json` 和 `.ttf`；仅放字体原件不能替代基础字体清单。

创建目录并初始化缓存权限：

```sh
mkdir -p /srv/linxie/deploy /srv/linxie/fonts /srv/linxie/cache
chown 1000:1000 /srv/linxie/cache
chmod 755 /srv/linxie/cache
```

目录创建后，将 `docker-compose.yaml` 和 `.env.example` 放到 `/srv/linxie/deploy/`，将字体资源复制到 `/srv/linxie/fonts/`，再创建环境配置：

```sh
cd /srv/linxie/deploy
test -e .env || cp .env.example .env
```

编辑 `.env`，为服务器部署指定 GHCR 镜像和实际路径：

```dotenv
LINXIE_IMAGE=ghcr.io/oner8/linxie:0.1.1
LINXIE_PORT=3100
LINXIE_FONT_DIR=/srv/linxie/fonts
LINXIE_CACHE_DIR=/srv/linxie/cache
```

字体目录只需对容器 UID `1000` 可读、可遍历（通常目录 `755`、文件 `644`），无需改为 `node` 所有；缓存目录必须可写。两者都使用宿主机挂载，`.env` 不受 Git 跟踪。现有配置使用 `:Z` 为本站独立目录设置 SELinux 标签，不要将宝塔或其他站点的共享目录用于这些挂载。

在包含配置文件的部署目录启动：

```sh
cd /srv/linxie/deploy
docker compose -f docker-compose.yaml config --quiet
docker compose -f docker-compose.yaml pull app
docker compose -f docker-compose.yaml up -d --wait app
docker compose -f docker-compose.yaml ps
curl --fail http://127.0.0.1:3100/api/health
```

若修改 `LINXIE_PORT`，健康检查地址和反向代理端口也要同步修改。端口默认只监听 `127.0.0.1`，通过现有 HTTPS 反向代理访问，不需要直接开放应用端口。宝塔配置示例见 `deploy/nginx-location.conf`，反代应覆盖 `X-Real-IP`，与 `TRUST_PROXY=1` 配合。

如需自己构建，在源码根目录执行以下命令，并将部署 `.env` 的 `LINXIE_IMAGE` 改为 `linxie:0.1.1`，使用本地镜像时跳过 `pull`：

```sh
docker build -t linxie:0.1.1 .
```

### 缓存权限与验证

应用以 `node` 用户运行，UID/GID 为 `1000:1000`。Dockerfile 已为镜像内部目录设置归属，但宿主机目录挂载会覆盖该目录，实际权限取决于宿主机。新目录若属于 `root:root` 且权限为 `755`，应用无法写入；换一个同样归属的目录也不能解决问题。上面的初始化步骤由部署者执行，当前镜像不会自动修正宿主机权限。

启动后检查实际用户和缓存目录：

```sh
cd /srv/linxie/deploy
docker compose -f docker-compose.yaml exec app sh -c 'id; echo "$FONT_CACHE_DIR"; ls -ld "$FONT_CACHE_DIR"; test -w "$FONT_CACHE_DIR" && echo "缓存可写" || echo "缓存不可写"'
docker compose -f docker-compose.yaml logs --tail 50 app
```

若出现 `no configuration file provided: not found`，表示当前目录没有配置文件，应进入部署目录，或在 `-f` 后填写配置文件绝对路径。无法定位配置文件时可直接检查容器；先用 `docker ps --format 'table {{.Names}}\t{{.Image}}'` 确认名称，以下使用默认的 `linxie-app-1`，名称不同时替换命令中的容器名。

对于已经运行的容器，先查看实际挂载，确认缓存挂载的 `rw=true`；再由宿主机 root 修正对应目录：

```sh
docker exec linxie-app-1 sh -c 'id; echo "$FONT_CACHE_DIR"; ls -ld "$FONT_CACHE_DIR"'
docker inspect linxie-app-1 --format '{{range .Mounts}}{{if eq .Destination "/app/data/cache"}}source={{.Source}} type={{.Type}} rw={{.RW}}{{end}}{{end}}'
linxie_cache_dir="$(docker inspect linxie-app-1 --format '{{range .Mounts}}{{if and (eq .Destination "/app/data/cache") (eq .Type "bind")}}{{.Source}}{{end}}{{end}}')"
if [ -n "$linxie_cache_dir" ] && [ "$linxie_cache_dir" != "/" ] && [ -d "$linxie_cache_dir" ]; then
  echo "修正缓存目录：$linxie_cache_dir"
  chown 1000:1000 -- "$linxie_cache_dir"
  chmod 755 -- "$linxie_cache_dir"
else
  echo "未找到有效的宿主机缓存目录，停止修改"
fi
```

只修正缓存目录本身，不递归修改字体目录或其他目录。权限修改通常立即生效；若缓存初始化之前已失败，修正后重启应用以重新初始化：

```sh
cd /srv/linxie/deploy
docker compose -f docker-compose.yaml restart app
```

实际写入测试会在缓存目录创建、重命名并清理一个随机临时文件，无需 Compose 配置文件：

```sh
docker exec linxie-app-1 node -e '
const fs = require("node:fs/promises");
const path = require("node:path");
const file = path.join(process.env.FONT_CACHE_DIR, "probe-" + require("node:crypto").randomUUID());
(async () => {
  try {
    await fs.writeFile(file, "ok", { flag: "wx" });
    await fs.rename(file, file + ".renamed");
    console.log("缓存创建、写入、重命名成功");
  } finally {
    await fs.unlink(file).catch(() => {});
    await fs.unlink(file + ".renamed").catch(() => {});
  }
})().catch(e => {
  console.error({ code: e.code, syscall: e.syscall, message: e.message });
  process.exitCode = 1;
});
'
```

`font_cache_write_failed` 表示缓存写入失败，当前日志未包含底层错误。测试返回 `EACCES` 时核对目录权限和 SELinux 标签，`EROFS` 时检查是否只读挂载，`ENOSPC` 时检查磁盘空间及 inode。`/api/health` 和容器 `healthy` 目前只验证基础字体资源，不能证明缓存可写。

第一次生成某款字体、某组汉字时，日志 `hit:false` 和响应头 `X-Font-Cache: MISS` 是正常的，生成后应有缓存文件。相同字体 ID、版本及汉字请求再次到达服务器时，应为 `hit:true` / `X-Font-Cache: HIT`；浏览器直接使用自身缓存时不会产生新的服务端日志。重启容器后缓存仍应保留。

### 更新与回退

更新前记录旧镜像标签并备份 `.env` 和字体清单。将 `.env` 的 `LINXIE_IMAGE` 改为需要的 GHCR 发布标签后执行：

```sh
cd /srv/linxie/deploy
docker compose -f docker-compose.yaml config --quiet
docker compose -f docker-compose.yaml pull app
docker compose -f docker-compose.yaml up -d --force-recreate --wait app
```

更改挂载目录或 `.env` 后也要重新创建容器，单独 `restart` 不会应用新挂载或新环境配置；新缓存目录同样需要初始化权限。回退时恢复旧镜像标签和必要的字体清单，执行相同启动命令，并重新验证健康与缓存；无需删除字体或清空缓存。

### 运行时增加字体

将静态 `.ttf` 或 `.otf` 原始字体复制到宿主机的 `LINXIE_FONT_DIR`（默认 `data/fonts/`）目录，刷新页面即可在内置字体列表中选择。无需修改 `fonts/catalog.json`、运行准备脚本、重启容器或重新构建镜像。

文件名去掉扩展名后作为展示名称，例如 `某某楷书.ttf`；名称中按“行楷、楷书、行书”的顺序识别书体，其余标为“其他”。同内容文件只显示一次；移除文件后刷新页面即从列表移除，替换文件会生成新的字体版本。

每款新增字体最多 30 MiB。符号链接、字体集合、可变字体及无法读取的文件会被跳过并记录服务日志，不影响基础字体。建议先复制到非字体扩展名的临时文件，复制完成后再重命名为 `.ttf` 或 `.otf`。新增字体只支持其实际包含的汉字；需要特殊修复的字体仍应加入 `fonts/catalog.json`，确认指纹及修复策略后运行准备脚本。
