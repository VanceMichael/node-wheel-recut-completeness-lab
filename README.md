# 轮轴工位收件

本地资料交换采用虚构机构、业务编号和文件，目录、原件与接收端响应均为合成数据。服务仅监听本机回环地址。

## 运行环境

使用 Node.js 22。启动前用 `npm ci` 恢复锁定清单，`npm start` 启动监听，`npm test` 检查来源接口及原件。监听端口可用 `PORT` 环境变量指定。申请示例保存于 `request.json`。

## 资料交换约定

组装记录有装配代号、轮片永久号和装配后的左右，脱轮时旧装配失效。读数声明的站位用该工位的 `view`（`front` 与 `reverse`）解释，反向站位需要交换。工位趟次内的标签是辅助证据，重标时以组装签单和原观测窗口为准。旋修记录给出实体、作业时间和失效项目范围。对于失效项目必须有同一实体作业后且与装配匹配的主图或复核原图，依据项目要求。主图和复核通道 HTTP 地址都在索引内，`preview` 对应缩略件；到期后返回 410，等候提供时返回 404。复检交接收件按 `requestId` 可查。

来源入口用 HTTP 返回资料。选择 `first` 或 `change` 可以观察同一批业务材料的两个时点，请向 `PUT /_source/phase` 提交包含 `phase` 的 JSON 对象。启动时默认 `first`。每个监听实例的演练时点及回执相互独立，新进程不继承演练端的状态。

接口路径、请求键及返回材料由 `wire.json` 描述，附属原件在 `materials` 中。路径表列出本地演练内容，不含外部网络服务。对返回文件的地址应领取对应响应，获取时的状态、时间及内容归属以来源声明为准。

| 方法和路径 | 查询字段 | 录入字段 |
| --- | --- | --- |
| `GET /assembly` | 无 | 无 |
| `GET /repair-log` | 无 | 无 |
| `GET /runs` | 无 | 无 |
| `GET /graphs/J1/raw` | 无 | 无 |
| `GET /graphs/J2/raw` | 无 | 无 |
| `GET /graphs/J3/raw` | 无 | 无 |
| `GET /graphs/J4/raw` | 无 | 无 |
| `GET /graphs/J2/preview` | 无 | 无 |
| `GET /graphs/J2/review` | 无 | 无 |
| `GET /handover-existing` | 无 | 无 |
| `POST /handover/review` | 无 | `requestId`、`work` |
| `GET /graphs/G-left-1/raw` | 无 | 无 |
| `GET /graphs/G-left-2/raw` | 无 | 无 |
| `GET /graphs/G-left-3/raw` | 无 | 无 |
| `GET /graphs/G-right-1/raw` | 无 | 无 |
| `GET /graphs/G-right-2/raw` | 无 | 无 |
| `GET /graphs/G-right-3/raw` | 无 | 无 |
| `GET /project-limits` | 无 | 无 |

回执可以按客户端办理号查询 `GET /receipts?requestId=…`。有时源端接受后会在返回前断开，查询仍能看到真实演练回执。
