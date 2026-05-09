# pdf-excel-text-check
pdf和excel数据对比程序，销售数据核验

需求：
现在公司需要对比pdf每一页数据的名称和excel的name列，检查数据条数和内容一致，怎么简单写个程序实现这个功能

程序设计：
使用 Python 是实现此功能最简单、最高效的选择。Python 拥有强大的 pdfplumber 和 pandas 库，非常适合此类数据处理任务。写个webapp，前端有左侧菜单，分文件管理、文件数据对比、文件对比记录，实现docker-compose部署

功能设计：
文件管理菜单功能实现：可以通过按钮或者拖拽到网页实现上传文件，可以对文件增删改查。文件管理页面默认显示上传的文件列表，显示文件名称，类型，大小，上传时间，修改时间，只能修改文件名

文件数据对比菜单：页面显示两个文件选择框和开始对比按钮，文件选择后要根据该文件不同格式文件显示不同的筛选规则，每个文件都有自己的筛选规则。如果是excel文件，文本筛选规则有sheet序号、列号、正则匹配。如果是pdf或其他分页类的文件，文本筛选规则有每页的行号、正则匹配。如果是txt等不分页文件，文本筛选规则有正则匹配

开始对比按钮实现：根据选择的文件以及选择的筛选规则把该文件对应的数据筛选出来放到数组，跳出弹窗逐条按序号显示对比结果，对比成功在数据后面画绿色对钩，对比错误则画红色叉，结尾显示对比了几条数据，成功几条，失败几条，成功率多少，如果100%，提示检查成功，把文件对比记录存到static文件夹里

文件对比记录菜单实现：列表显示对比记录，显示对比文件名称、对比时间、数据条数、成功条数、失败条数、成功率。点开详情跳出弹窗看详细对比记录

## 运行

本地：

```bash
python3 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
uvicorn app.main:app --reload --port 8000
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
```

浏览器打开 `http://127.0.0.1:8000`。

Docker：

```bash
docker compose up --build
```

上传文件、对比记录分别持久化在 `data/` 与 `static/records/`（与 compose 挂载一致）。
