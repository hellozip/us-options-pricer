# 美股期权定价工作台

本网页用于输入美股期权合约，自动拉取 Yahoo Finance 日线行情和 Cboe 延迟期权报价，用期权市场价反推出欧式/美式隐含波动率，并用 Black-Scholes 和 CRR 二叉树给出参考理论价。

## 本地运行

```powershell
cd option_pricer_web
python app.py
```

打开：

```text
http://127.0.0.1:8092
```

## 部署到公网

这个项目包含后端行情代理，建议部署为 Render Web Service、Railway、Fly.io 或 VPS 服务，不建议只用 GitHub Pages。

Render 最简流程：

1. 把 `option_pricer_web` 目录推到一个 GitHub 仓库。
2. 在 Render 新建 Web Service，选择这个仓库。
3. Render 会读取 `render.yaml`。
4. 部署后会得到类似 `https://us-options-pricer.onrender.com` 的公网网址。
5. 如果要绑定自己的域名，在 Render 的 Custom Domains 添加域名，再到域名商 DNS 里配置 CNAME。

## 支持的期权格式

```text
AAPL270115C00300000
AAPL 2026-01-16 200 C
AAPL 200C 2026-01-16
NVDA 2026/01/16 150 PUT
```

## 说明

- 行情源使用 Yahoo Finance chart JSON 接口。
- 期权报价源使用 Cboe delayed quotes；自动取 Bid/Ask 中间价作为反推 IV 的市场价，也可手动输入期权市场价。
- 历史波动率来自标的历史对数收益率年化值，只作为参考输入。
- 隐含波动率使用数值二分法反推：寻找使模型价格等于期权市场价的 `sigma`。
- 欧式期权使用 Black-Scholes-Merton 公式。
- 美式期权使用 Cox-Ross-Rubinstein 二叉树，并允许每一步提前行权。
- 页面支持输入盘后价或假设现价，自动重算对应理论价格。
