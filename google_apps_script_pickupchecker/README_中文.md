# PickupChecker 第二套监控（中文说明）

**原来的 Apple 直查项目不要修改，也不要关闭。**

本项目使用 PickupChecker 官方免费 JSON API（无需 API Key）：https://pickupchecker.com/iphone-duo-stock-api

库存 API：https://pickupchecker.com/api/v1/us/stock?model=duo

监控 iPhone Duo / 256GB / Star White；门店为 Evergreen Walk（R613）和 Westfarms（R025）。每分钟计划请求一次，一个请求包含两家店。Gmail 通知仍发送给你和第二位收件人；邮件内会注明 Source: PickupChecker 并链接到 https://pickupchecker.com/。

## 1. 在第二个 Google Apps Script 项目更新代码

1. 打开 https://script.google.com/home ，选择之前新建的第二个项目 iPhone Duo InStock Radar Monitor。**不要打开旧项目 iPhone Duo Stock Monitor。**
2. 可以把第二个项目改名为 iPhone Duo PickupChecker Monitor。
3. 打开 https://github.com/williamccc7/duo-stock-watch/blob/main/google_apps_script_pickupchecker/Code.gs ，点击 Raw，复制全部代码。
4. 返回第二个 Apps Script 项目 Editor → Code.gs，全选旧代码并粘贴新版，按 Command + S 保存。
5. 原来设置的 ADDITIONAL_ALERT_EMAILS Script property 会保留；如果没有，请到 Project Settings → Script properties 中填写第二位收件人的邮箱。

## 2. 先运行测试，不要先建 Trigger

在函数下拉菜单选择并 Run：

1. testParser：应显示 PickupChecker parser: all four offline tests passed.
2. testPickupChecker：实际请求 PickupChecker API，但不发有货邮件、不改动库存状态；应分别输出 Evergreen Walk 和 Westfarms 的状态和 last_checked_at 时间。
3. testEmail：两位收件人应该收到 [PickupChecker TEST] 测试邮件。

若 testPickupChecker 出错（如 HTTP 429、门店缺失、数据过旧），请先发回错误日志排查。我们已经完成模拟数据测试，但还没有在 Google Apps Script 中真实读取 API。

## 3. 开启每分钟自动运行

测试成功后，在第二个项目选择 startEveryMinute → Run 一次。

第二个项目 Triggers 应只有一条 checkPickupStock、Time-driven、Every minute 触发器。
该函数会自动清除第二个项目可能残留的 checkRadarStock 旧触发器；旧 Apple 项目不受影响。不需要 Deploy。

## 4. 查看结果

Executions 的每次 checkPickupStock 执行会分别显示两家门店的状态。只有目标配置由无货转为有货，才会发送主题包含 [PickupChecker] 和店名的提醒邮件。状态在两家门店之间相互独立。出现 HTTP 错误不会被当成缺货；HTTP 429 时会按服务器的 Retry-After 暂停请求，连续失败时会发故障邮件。

## 注意

- 官方 API 建议每个接口至少间隔 30 秒、保持在每分钟每 IP 60 个请求以内；这个代码每分钟仅请求一次。
- 官网要求展示其数据时注明来源，提醒邮件已包含 Source: PickupChecker — https://pickupchecker.com/。
- API 缓存约 30 秒；Google 的每分钟计划触发也并不保证精确执行，可能错过非常短的补货。
- 两个项目会共同消耗你的 Google Apps Script 免费配额，特别是每天 90 分钟的触发器累计运行时间。
- 有货后仍需在 Apple 官网确认可到店自取，并核对 No trade-in / Connect to any carrier later。
- 只停止第二套时运行第二项目的 stopMonitoring，旧 Apple 监控不会停止。
