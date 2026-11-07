# iPhone Duo：升级为 Evergreen Walk + Westfarms 两店监控

目标：同一商品 `MK1E4LL/A`，256GB Star White；两店分别判断库存并发 Gmail，继续使用已启用的 `checkStock` 触发器。

- Apple Evergreen Walk：R613，401 Evergreen Walk, South Windsor, CT 06074
- Apple Westfarms：R025，500 Westfarms Mall, Farmington, CT 06032
- 每轮**只查询一次** Apple 官方网站库存接口，通过位置 06032 的响应同时识别两家门店。
- 两家门店用独立的存储状态，避免互相覆盖；提醒邮件主题包含对应店名。
- 保留 HTTP 541 冷却机制与连续错误邮件。
- `No Trade-in` 和 `Connect to any carrier later` 在 Apple 官网结账时选择确认。

## 如何让运行中的 Google Apps Script 生效

GitHub 的修改不会自动同步到现有的 Apps Script 项目！请在 Google Apps Script 的旧项目里手动更新：

1. 打开 https://script.google.com/home ，找到已经在运行的 `iPhone Duo Stock Monitor` 项目，点击进入。
2. 选择左侧 Editor → `Code.gs`。先保留一份旧代码副本以便回滚。
3. 打开 https://github.com/williamccc7/duo-stock-watch/blob/main/google_apps_script/Code.gs ，点击 Raw，复制全部代码。
4. 回到 Apps Script 的 `Code.gs`，全选旧代码 → 粘贴新版 → 保存。
5. 在上方函数选择菜单选择 `showStatus` → Run，确认输出里有两家店名称。
6. 选择 `checkStock` → Run，再查看 Execution log。确认同时出现 `Evergreen Walk: Currently unavailable.` 与 `Westfarms: Currently unavailable.`（如果某家已到货，会显示 `NEW STOCK` 并触发 Gmail）。
7. 左侧 Triggers 中确认只有一个 `checkStock` 时间触发器，而且仍是 Every minute（或你实际使用的原间隔）。**不要再按 Run 执行 startEveryMinute**，除非想重建触发器。

任何 `Inventory check failed` 或某家门店 `missing` 都表示还没有完成正常验证，不要把错误当作无货。

## 注意

- Google Apps Script 定时调度和 Apple 库存接口都不保证每分钟准时或永远可用。
- 每分钟只有 1 次网络请求，按计划每天最多 1440 次；仍受 Google 免费配额限制。
- Apple 返回 HTTP 541 时可能暂停请求 15–60 分钟；这种时候不能视为缺货。
- 若要暂停脚本，选择 `stopMonitoring` 并执行；Google 的触发器会被删除。
